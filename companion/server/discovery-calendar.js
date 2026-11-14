'use strict';
// RFC 5545: escape text and fold UTF-8 content lines at 75 octets.
const escapeText = value => String(value || '').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
function fold(line) {
  let out='',bytes=0;
  for(const char of line){const size=Buffer.byteLength(char);if(bytes+size>75){out+='\r\n ';bytes=1;}out+=char;bytes+=size;}
  return out;
}
const stamp = value => new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function calendar(x,publicUrl) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//THE LAB//Discovery//EN','CALSCALE:GREGORIAN','BEGIN:VEVENT',
    'UID:'+x.id+'@the-lab-discovery','DTSTAMP:'+stamp(new Date()),'SEQUENCE:'+x.version,
    'DTSTART:'+stamp(x.starts_at),'DTEND:'+stamp(x.ends_at),
    'SUMMARY:'+escapeText('THE LAB '+({drill:'Drill',play:'Play',either:'Drill or play'}[x.kind])+' session'),
    'LOCATION:'+escapeText(x.place),'STATUS:'+(['cancelled','removed'].includes(x.status)?'CANCELLED':'CONFIRMED'),
    'DESCRIPTION:'+escapeText([x.focus,'Reservation: '+x.reservation_status,'Venue access: '+x.venue_access,'Venue fees: '+(x.venue_fee||'Confirm with host'),x.venue_notes,'Court booking and entry are separate. Check THE LAB for changes.'].filter(Boolean).join('\n')),
    'URL:'+publicUrl+'/#/discovery/session/'+x.id,'END:VEVENT','END:VCALENDAR'];
  return lines.map(fold).join('\r\n')+'\r\n';
}
module.exports={calendar};
