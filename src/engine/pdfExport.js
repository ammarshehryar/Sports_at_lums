// pdfExport.js
// Renders the schedule table to a downloadable PDF.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export function exportScheduleToPdf(rows, filename = 'schedule.pdf') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text('Tournament Schedule', 40, 40);
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated ${new Date().toLocaleString()} · ${rows.length} matches`, 40, 56);

  autoTable(doc, {
    startY: 72,
    head: [['#', 'Sport', 'Group', 'Team/Player A', 'Delegation A', 'Team/Player B', 'Delegation B', 'Venue', 'Date', 'Time']],
    body: rows.map((r) => [
      r.matchNumber,
      r.sport,
      r.group ? `Group ${r.group}` : '',
      r.teamA,
      r.delegationA,
      r.teamB,
      r.delegationB,
      r.venue,
      r.date,
      r.startTime ? `${r.startTime} - ${r.endTime}` : '',
    ]),
    styles: { fontSize: 8, cellPadding: 4, textColor: [30, 41, 59] },
    headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    theme: 'grid',
  });

  doc.save(filename);
}
