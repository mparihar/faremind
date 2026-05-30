import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ── FareMind brand colours ──
const TEAL    = [26, 188, 156] as const;  // #1ABC9C
const DARK    = [15, 23, 42]   as const;  // #0F172A
const SLATE   = [30, 41, 59]   as const;  // #1E293B
const BORDER  = [51, 65, 85]   as const;  // #334155
const LIGHT   = [226, 232, 240] as const; // #E2E8F0
const MUTED   = [100, 116, 139] as const; // #64748B
const WHITE   = [255, 255, 255] as const;

function drawLogo(doc: jsPDF, x: number, y: number) {
  // Paper-plane icon (simplified triangle shape)
  doc.setFillColor(...WHITE);
  doc.triangle(x, y + 12, x + 8, y + 4, x + 14, y + 14, 'F');
  doc.setFillColor(...TEAL);
  doc.triangle(x + 3, y + 12, x + 8, y + 7, x + 10, y + 14, 'F');

  // "FARE" in white
  doc.setTextColor(...WHITE);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('FARE', x + 18, y + 14);
  
  // "MIND" in teal
  doc.setTextColor(...TEAL);
  doc.text('MIND', x + 18 + doc.getTextWidth('FARE'), y + 14);
}

export function generatePdf(booking: any, action: 'download' | 'base64' = 'base64'): string | void {
  const doc = new jsPDF();
  const pw = doc.internal.pageSize.getWidth();
  const currency = booking.currency || 'USD';
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  const dateFmt = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';

  // ── Dark header bar ──
  doc.setFillColor(...SLATE);
  doc.rect(0, 0, pw, 32, 'F');
  doc.setDrawColor(...BORDER);
  doc.line(0, 32, pw, 32);
  drawLogo(doc, 14, 4);

  // Subtitle
  doc.setTextColor(...MUTED);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Flight Itinerary & Receipt', pw - 14, 14, { align: 'right' });
  doc.text(`Generated ${new Date().toLocaleDateString()}`, pw - 14, 20, { align: 'right' });

  let y = 42;

  // ── Booking Reference Badge ──
  doc.setFillColor(...DARK);
  doc.setDrawColor(...TEAL);
  doc.roundedRect(14, y, pw - 28, 30, 3, 3, 'FD');
  doc.setTextColor(...MUTED);
  doc.setFontSize(8);
  doc.text('FAREMIND BOOKING REFERENCE', pw / 2, y + 9, { align: 'center' });
  doc.setTextColor(...TEAL);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(booking.masterBookingReference || 'N/A', pw / 2, y + 22, { align: 'center' });

  if (booking.masterPnr && booking.masterPnr !== booking.masterBookingReference) {
    doc.setTextColor(...MUTED);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`AIRLINE PNR: ${booking.masterPnr}`, pw / 2, y + 28, { align: 'center' });
  }
  y += 38;

  // ── Flight Route Card ──
  doc.setFillColor(...DARK);
  doc.setDrawColor(...BORDER);
  const routeH = 40;
  doc.roundedRect(14, y, pw - 28, routeH, 3, 3, 'FD');

  const flights = booking.journeys || [];
  if (flights.length > 0) {
    const j = flights[0];
    const origin = j.originAirport || booking.originAirport;
    const dest   = j.destinationAirport || booking.destinationAirport;
    doc.setTextColor(...LIGHT);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    const mid = pw / 2;
    doc.text(origin, mid - 30, y + 18, { align: 'center' });
    doc.setTextColor(...TEAL);
    doc.setFontSize(16);
    doc.text('⇄', mid, y + 17, { align: 'center' });
    doc.setTextColor(...LIGHT);
    doc.setFontSize(22);
    doc.text(dest, mid + 30, y + 18, { align: 'center' });

    // Info row
    doc.setDrawColor(...BORDER);
    doc.line(20, y + 24, pw - 20, y + 24);

    doc.setTextColor(...MUTED);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    const infoY = y + 32;
    const seg0 = (j.segments || [])[0];
    const airline = seg0?.airlineName || booking.primaryProvider || '';
    const cabin   = seg0?.cabinClass || '';
    doc.text(`Airline: ${airline}`, 22, infoY);
    if (cabin) doc.text(`Class: ${cabin}`, pw / 2 - 10, infoY);
    doc.setTextColor(...TEAL);
    doc.setFont('helvetica', 'bold');
    doc.text(`Status: ${booking.bookingStatus}`, pw - 22, infoY, { align: 'right' });
  } else {
    doc.setTextColor(...LIGHT);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(booking.originAirport || '', pw / 2 - 30, y + 18, { align: 'center' });
    doc.setTextColor(...TEAL);
    doc.setFontSize(16);
    doc.text('⇄', pw / 2, y + 17, { align: 'center' });
    doc.setTextColor(...LIGHT);
    doc.setFontSize(22);
    doc.text(booking.destinationAirport || '', pw / 2 + 30, y + 18, { align: 'center' });
  }
  y += routeH + 8;

  // ── Journey Details ──
  if (flights.length > 0) {
    flights.forEach((j: any, ji: number) => {
      doc.setTextColor(...LIGHT);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(`${j.direction === 'RETURN' ? 'Return' : 'Outbound'} Flight`, 14, y);
      doc.setTextColor(...MUTED);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(dateFmt(j.departureDate || booking.departureDate), 14 + 70, y);
      y += 4;

      const segRows = (j.segments || []).map((s: any) => [
        s.flightNumber || s.marketingFlightNumber || '',
        s.airlineName || '',
        s.departureTime ? new Date(s.departureTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '',
        s.arrivalTime ? new Date(s.arrivalTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '',
        s.cabinClass || '',
        s.aircraft || '',
      ]);

      if (segRows.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Flight', 'Airline', 'Departure', 'Arrival', 'Class', 'Aircraft']],
          body: segRows,
          theme: 'plain',
          styles: { fontSize: 8, textColor: LIGHT as any, cellPadding: 3 },
          headStyles: { fillColor: DARK as any, textColor: MUTED as any, fontStyle: 'bold', fontSize: 7 },
          bodyStyles: { fillColor: DARK as any },
          alternateRowStyles: { fillColor: [17, 24, 39] },
          tableLineColor: BORDER as any,
          tableLineWidth: 0.2,
          margin: { left: 14, right: 14 },
        });
        y = (doc as any).lastAutoTable.finalY + 6;
      }
    });
  }

  // ── Passengers ──
  doc.setTextColor(...LIGHT);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('PASSENGERS', 14, y + 2);
  y += 6;

  const paxRows = (booking.passengers || []).map((p: any) => [
    `${p.firstName} ${p.lastName}`,
    (p.passengerType || 'Adult').toUpperCase(),
    p.ticketNumber || 'Pending',
    p.email || '',
    p.phone || '',
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Name', 'Type', 'Ticket', 'Email', 'Phone']],
    body: paxRows,
    theme: 'plain',
    styles: { fontSize: 8, textColor: LIGHT as any, cellPadding: 3 },
    headStyles: { fillColor: DARK as any, textColor: MUTED as any, fontStyle: 'bold', fontSize: 7 },
    bodyStyles: { fillColor: DARK as any },
    alternateRowStyles: { fillColor: [17, 24, 39] },
    tableLineColor: BORDER as any,
    tableLineWidth: 0.2,
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Page check
  if (y > 240) { doc.addPage(); y = 20; }

  // ── Payment Summary ──
  doc.setTextColor(...LIGHT);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('PAYMENT SUMMARY', 14, y + 2);
  y += 6;

  const paymentRows = [
    ['Total Charged', fmt(Number(booking.totalAmount))],
    ['Payment Status', (booking.paymentStatus || '').replace('_', ' ')],
    ['Ticketing Status', (booking.ticketingStatus || '').replace('_', ' ')],
    ['Trip Type', (booking.tripType || '').replace('_', ' ')],
    ['Provider', booking.primaryProvider || ''],
    ['Booked On', new Date(booking.createdAt).toLocaleDateString()],
  ];

  autoTable(doc, {
    startY: y,
    body: paymentRows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: {
      0: { textColor: MUTED as any, cellWidth: 60 },
      1: { textColor: LIGHT as any, fontStyle: 'bold', halign: 'right' },
    },
    bodyStyles: { fillColor: DARK as any },
    alternateRowStyles: { fillColor: [17, 24, 39] },
    tableLineColor: BORDER as any,
    tableLineWidth: 0.2,
    margin: { left: 14, right: 14 },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── Next Steps ──
  if (y > 248) { doc.addPage(); y = 20; }
  doc.setTextColor(...LIGHT);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('NEXT STEPS', 14, y);
  y += 6;

  doc.setTextColor(...MUTED);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  const steps = [
    '• Check your passport and travel documents.',
    '• Check in with the airline when check-in opens (usually 24h before departure).',
    '• Boarding passes are available after airline check-in.',
    `• Use your booking reference ${booking.masterBookingReference} to manage your booking.`,
    '• Seat assignments, terminal, and gate info may be updated closer to departure.',
  ];
  steps.forEach(s => {
    doc.text(s, 16, y);
    y += 5;
  });

  // ── Footer ──
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFillColor(...DARK);
  doc.rect(0, pageH - 16, pw, 16, 'F');
  doc.setDrawColor(...BORDER);
  doc.line(0, pageH - 16, pw, pageH - 16);
  doc.setTextColor(...MUTED);
  doc.setFontSize(7);
  doc.text('FareMind · faremind.ai · support@faremind.ai', pw / 2, pageH - 8, { align: 'center' });
  doc.text(`© ${new Date().getFullYear()} FareMind. All rights reserved.`, pw / 2, pageH - 4, { align: 'center' });

  if (action === 'download') {
    doc.save(`FareMind-Itinerary-${booking.masterBookingReference}.pdf`);
  } else {
    const dataUri = doc.output('datauristring');
    return dataUri.split(',')[1];
  }
}
