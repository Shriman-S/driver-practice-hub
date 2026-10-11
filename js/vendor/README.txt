Third-party libraries bundled with DriveLab so the PDF export works without any internet connection or CDN.

  jspdf.umd.min.js                  jsPDF 4.2.1        (MIT license: jspdf-LICENSE.txt)
  jspdf.plugin.autotable.min.js     jsPDF-AutoTable 5.0.8 (MIT license: jspdf-autotable-LICENSE.txt)

They are loaded only when someone clicks "Export PDF" (see js/pdf.js). To update them, run `npm install jspdf jspdf-autotable`
and copy the two files named above from node_modules/jspdf/dist and node_modules/jspdf-autotable/dist.
