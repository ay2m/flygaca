export interface SaudiAirport {
  icao: string;
  iata: string;
  name: string;
  city: string;
}

export const MAJOR_SAUDI_AIRPORTS: SaudiAirport[] = [
  { icao: 'OERK', iata: 'RUH', name: "King Khalid Int'l", city: 'Riyadh' },
  { icao: 'OEJN', iata: 'JED', name: "King Abdulaziz Int'l", city: 'Jeddah' },
  { icao: 'OEDF', iata: 'DMM', name: "King Fahd Int'l", city: 'Dammam' },
  { icao: 'OEMA', iata: 'MED', name: "Prince Mohammad Int'l", city: 'Medina' },
  { icao: 'OEAB', iata: 'AHB', name: "Abha Int'l", city: 'Abha' },
  { icao: 'OETF', iata: 'TIF', name: 'Taif Regional', city: 'Taif' },
  { icao: 'OETB', iata: 'TUU', name: "Prince Sultan Int'l", city: 'Tabuk' },
  { icao: 'OEHL', iata: 'HAS', name: 'Hail Regional', city: 'Hail' },
  { icao: 'OEGN', iata: 'GIZ', name: 'King Abdullah Regional', city: 'Jazan' },
  { icao: 'OEGS', iata: 'ELQ', name: "Prince Naif Int'l", city: 'Qassim' },
];

export function getAirportLabel(icao?: string): string {
  if (!icao) return '';
  const code = icao.toUpperCase().trim();
  const apt = MAJOR_SAUDI_AIRPORTS.find((a) => a.icao === code);
  if (apt) return `${apt.city} (${apt.icao})`;
  return code;
}

export interface PilotRankInfo {
  titleKey: string;
  fallbackTitle: string;
  stripes: number; // 2, 3, 4
  isInstructor?: boolean;
}

export function getPilotRank(role?: string, licenceType?: string): PilotRankInfo {
  if (role === 'instructor') {
    return { titleKey: 'account.rankInstructor', fallbackTitle: 'Flight Instructor', stripes: 3, isInstructor: true };
  }
  if (licenceType === 'ATPL') {
    return { titleKey: 'account.rankCaptain', fallbackTitle: 'Captain (ATPL)', stripes: 4 };
  }
  if (licenceType === 'CPL') {
    return { titleKey: 'account.rankFO', fallbackTitle: 'First Officer (CPL)', stripes: 3 };
  }
  if (licenceType === 'SPL' || role === 'student') {
    return { titleKey: 'account.rankCadet', fallbackTitle: 'Cadet Pilot', stripes: 2 };
  }
  if (licenceType === 'PPL') {
    return { titleKey: 'account.roles.pilot', fallbackTitle: 'Command Pilot (PPL)', stripes: 3 };
  }
  return { titleKey: 'account.roles.pilot', fallbackTitle: 'Pilot', stripes: 3 };
}
