import { firebaseConfig, firebaseEnabled } from "./config.js";

// This adapter provides a functional browser-only preview, then switches to protected shared storage after Firebase setup.
const KEY = "drivelab-preview-v1";
const empty = { submissions: [], events: [], courses: {}, customForms: [] };
let database = structuredClone(empty);
let remote = null;
const readLocal = () => {
	try {
		return JSON.parse(localStorage.getItem(KEY)) || structuredClone(empty);
	} catch {
		return structuredClone(empty);
	}
};
const saveLocal = () => localStorage.setItem(KEY, JSON.stringify(database));
const copy = (value) => structuredClone(value);

export async function initializeStorage() {
	database = readLocal();
	if (!firebaseEnabled) return { mode: "local", user: null, isAdmin: false };
	// CDN imports keep the project install-free; pinning a version avoids surprise breaking changes.
	const [app, auth, firestore] = await Promise.all([
		import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
		import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"),
		import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"),
	]);
	const firebaseApp = app.initializeApp(firebaseConfig);
	const firebaseAuth = auth.getAuth(firebaseApp);
	const db = firestore.getFirestore(firebaseApp);
	await auth.signInAnonymously(firebaseAuth); // Public recorders receive a non-identifying account that can create, not read, submissions.
	remote = {
		auth,
		firestore,
		firebaseAuth,
		db,
		user: firebaseAuth.currentUser,
		admin: false,
	};
	return { mode: "firebase", user: remote.user, isAdmin: false };
}
export async function signInAdmin() {
	if (!remote)
		throw new Error("Add Firebase configuration before administrator sign-in.");
	const provider = new remote.auth.GoogleAuthProvider();
	provider.setCustomParameters({ prompt: "select_account" }); // always show the account chooser, so logging out and back in never silently reuses the previous account
	const result = await remote.auth.signInWithPopup(
		remote.firebaseAuth,
		provider,
	);
	remote.user = result.user;
	// The rules let an account read its own `admins` document only if it is already an administrator,
	// so for everyone else this read is rejected with "permission-denied". Treat that as "not an administrator".
	try {
		const admin = await remote.firestore.getDoc(
			remote.firestore.doc(remote.db, "admins", result.user.uid),
		);
		remote.admin = admin.exists();
	} catch (error) {
		if (error.code !== "permission-denied") throw error;
		remote.admin = false;
	}
	return { user: result.user, isAdmin: remote.admin };
}
// Ends the administrator session and returns to a guest (anonymous) identity so the person can keep recording practices.
export async function signOutAdmin() {
	if (!remote) return { mode: "local", user: null, isAdmin: false };
	await remote.auth.signOut(remote.firebaseAuth);
	remote.admin = false;
	remote.user = null; // administrator rights end the moment Firebase signs the account out
	try {
		await ensureGuest();
	} catch {
		/* no network right now: a guest identity is created again when the next practice is submitted */
	}
	return { mode: "firebase", user: remote.user, isAdmin: false };
}
// Guests need *some* signed-in identity (the rules require one to create a submission); create an anonymous one if there is none.
async function ensureGuest() {
	if (remote.user) return;
	await remote.auth.signInAnonymously(remote.firebaseAuth);
	remote.user = remote.firebaseAuth.currentUser;
}
export function getAdminUid() {
	return remote?.user?.uid || "";
}
export function isRemote() {
	return Boolean(remote);
}
// Collections the Firestore rules let EVERYONE read: the calendar, the published course layouts, and the custom practice forms.
// Submissions are administrator-only. If the deployed rules are older than this version, the public reads of courses / customForms
// are denied; that is tolerated (those lists simply stay empty) and reported through getLoadWarnings() so the sidebar can say so.
let loadWarnings = [];
export function getLoadWarnings() {
	return loadWarnings;
}

export async function loadAll() {
	loadWarnings = [];
	if (!remote) return copy(database);
	const f = remote.firestore;
	const db = remote.db;
	// A denied read of one collection must never stop the others (or the whole app) from loading.
	const read = async (name, allowed = true) => {
		if (!allowed) return null;
		try {
			return await f.getDocs(f.collection(db, name));
		} catch (error) {
			if (error.code !== "permission-denied") throw error;
			loadWarnings.push(name);
			return null;
		}
	};
	const [events, courses, forms, submissions] = await Promise.all([
		read("events"),
		read("courses"),
		read("customForms"),
		read("submissions", remote.admin),
	]);
	// `id` goes LAST so the Firestore document id always wins over any `id` field stored inside the document. Deleting uses this id,
	// and submissions saved by older versions have an auto-generated document id that differs from their stored `id` field.
	const rows = (snapshot) =>
		snapshot ? snapshot.docs.map((x) => ({ ...x.data(), id: x.id })) : [];
	return {
		events: rows(events),
		courses: courses
			? Object.fromEntries(courses.docs.map((x) => [x.id, x.data()]))
			: {},
		customForms: rows(forms),
		submissions: rows(submissions),
	};
}
export async function addSubmission(item) {
	if (!remote) {
		database.submissions.push(item);
		saveLocal();
		return;
	}
	await ensureGuest();
	// setDoc with an explicit id (instead of addDoc's random one) keeps the document id equal to item.id, so what is on screen can be deleted by id.
	await remote.firestore.setDoc(
		remote.firestore.doc(remote.db, "submissions", item.id),
		{ ...item, userId: remote.user.uid },
	);
}
export async function saveRecord(type, item) {
	if (!remote) {
		const list = database[type];
		const index = list.findIndex((x) => x.id === item.id);
		index < 0 ? list.push(item) : (list[index] = item);
		saveLocal();
		return;
	}
	await remote.firestore.setDoc(
		remote.firestore.doc(remote.db, type, item.id),
		item,
	);
}
export async function removeRecord(type, id) {
	if (!remote) {
		database[type] = database[type].filter((x) => x.id !== id);
		saveLocal();
		return;
	}
	await remote.firestore.deleteDoc(remote.firestore.doc(remote.db, type, id));
}
export async function saveCourse(id, item) {
	if (!remote) {
		database.courses[id] = item;
		saveLocal();
		return;
	}
	await remote.firestore.setDoc(
		remote.firestore.doc(remote.db, "courses", id),
		item,
	);
}
// Deletes one course layout. (Courses are stored as an object keyed by id locally, unlike the other record lists.)
export async function removeCourse(id) {
	if (!remote) {
		delete database.courses[id];
		saveLocal();
		return;
	}
	await remote.firestore.deleteDoc(
		remote.firestore.doc(remote.db, "courses", id),
	);
}
