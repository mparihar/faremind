// ── SSR meal code registry ────────────────────────────────────────────────────
// Knowledge base only — not the source of truth for what to display.
// The /api/meals route determines which codes are available per flight.

export interface MealOptionDef {
  code: string;
  label: string;
  desc: string;
  emoji: string;
  accent: string;   // Tailwind color name for chip tint (slate, green, emerald…)
  price: number;    // 0 = included in fare
}

export const SSR_MAP: Record<string, Omit<MealOptionDef, 'code' | 'price'>> = {
  STANDARD: { label: 'Standard',    desc: 'Regular airline meal',     emoji: '🍽️', accent: 'slate'   },
  VGML:     { label: 'Vegetarian',  desc: 'Lacto-ovo, no meat',       emoji: '🥗',  accent: 'green'   },
  AVML:     { label: 'Asian Veg',   desc: 'Spiced vegetarian',        emoji: '🌿',  accent: 'emerald' },
  NLML:     { label: 'Vegan',       desc: 'No animal products',       emoji: '🌱',  accent: 'emerald' },
  MOML:     { label: 'Halal',       desc: 'Muslim certified',         emoji: '☪️',  accent: 'blue'    },
  KSML:     { label: 'Kosher',      desc: 'Jewish dietary laws',      emoji: '✡️',  accent: 'indigo'  },
  HNML:     { label: 'Hindu',       desc: 'No beef or pork',          emoji: '🪔',  accent: 'orange'  },
  CHML:     { label: 'Child',       desc: 'Kid-friendly menu',        emoji: '🧒',  accent: 'amber'   },
  BBML:     { label: 'Baby',        desc: 'For infants under 2',      emoji: '🍼',  accent: 'pink'    },
  DBML:     { label: 'Diabetic',    desc: 'Low sugar, controlled',    emoji: '💊',  accent: 'orange'  },
  GFML:     { label: 'Gluten-Free', desc: 'No gluten products',       emoji: '🌾',  accent: 'yellow'  },
  LFML:     { label: 'Low Fat',     desc: 'Low fat & sodium',         emoji: '🥦',  accent: 'green'   },
  FPML:     { label: 'Fruit Plate', desc: 'Fresh fruit selection',    emoji: '🍎',  accent: 'rose'    },
  SFML:     { label: 'Seafood',     desc: 'Fresh seafood option',     emoji: '🦐',  accent: 'cyan'    },
  LCML:     { label: 'Low Cal',     desc: 'Calorie-controlled',       emoji: '⚖️',  accent: 'lime'    },
  VJML:     { label: 'Jain',        desc: 'No root vegetables',       emoji: '🕊️',  accent: 'amber'   },
  NONE:     { label: 'Skip Meal',   desc: 'No in-flight service',     emoji: '—',   accent: 'slate'   },
};

export function resolveMeal(code: string, price = 0): MealOptionDef {
  const def = SSR_MAP[code.toUpperCase()];
  if (def) return { code: code.toUpperCase(), ...def, price };
  // Unknown SSR — render generically
  return { code, label: code, desc: 'Special meal', emoji: '✦', accent: 'slate', price };
}

// ── Route-based recommendation logic ─────────────────────────────────────────

const INDIA_AIRPORTS   = new Set(['DEL','BOM','MAA','HYD','CCU','AMD','GOI','COK','PNQ','BLR','JAI','IXC','ATQ']);
const MIDDLE_E_AIRPORTS = new Set(['DXB','AUH','DOH','KWI','BAH','MCT','RUH','JED','AMM','CAI','BEY']);
const ASIA_AIRPORTS     = new Set(['SIN','BKK','KUL','HKG','NRT','ICN','PEK','PVG','MNL','CGK','SGN','HAN']);

export function getRecommendedCode(
  origin: string,
  destination: string,
  airlineCode?: string,
): string {
  const dest = destination.toUpperCase();
  const orig = origin.toUpperCase();

  if (INDIA_AIRPORTS.has(dest) || INDIA_AIRPORTS.has(orig)) return 'AVML';
  if (MIDDLE_E_AIRPORTS.has(dest) || MIDDLE_E_AIRPORTS.has(orig)) return 'MOML';
  if (ASIA_AIRPORTS.has(dest) || ASIA_AIRPORTS.has(orig)) return 'VGML';

  // Middle Eastern airlines → Halal
  if (airlineCode && ['EK','QR','EY','SV','GF','WY','ME'].includes(airlineCode.toUpperCase())) {
    return 'MOML';
  }

  return 'STANDARD';
}

// ── Default meal sets by flight duration ─────────────────────────────────────

export function getDefaultMealCodes(durationMinutes: number, hasChildren: boolean): string[] {
  const base = ['STANDARD'];

  if (durationMinutes < 90) {
    // Very short — no meal service
    return ['STANDARD', 'NONE'];
  }

  if (durationMinutes < 240) {
    // Short-haul — limited options
    return ['STANDARD', 'VGML', 'MOML', 'NONE'];
  }

  // Long-haul — full menu
  const codes = ['STANDARD', 'VGML', 'AVML', 'NLML', 'MOML', 'KSML', 'HNML', 'DBML', 'GFML', 'NONE'];
  if (hasChildren) codes.splice(-1, 0, 'CHML'); // insert before NONE
  return codes;
}
