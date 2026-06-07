const fs = require('fs');
const lines = fs.readFileSync('c:/FareMind/src/app/page.tsx', 'utf8').split('\n');
const dnaSectionStart = lines.findIndex(l => l.includes('{/* ═══ TRAVEL DNA SHOWCASE ═══ */}'));
const dnaSectionEnd = lines.findIndex((l, i) => i > dnaSectionStart && l.includes('</section>'));

// Extract the motion.div
const motionStart = lines.findIndex((l, i) => i > dnaSectionStart && l.includes('<motion.div'));
const motionEnd = lines.findIndex((l, i) => i > motionStart && l.includes('</motion.div>') && lines[i-1].includes('</div>')); // wait, travel DNA has multiple motion.divs.
// To be safe, let's find the closing tag for the main travel DNA motion div.
// It is preceded by `</div>` which is the flex-1 text-center container, which is preceded by `</div>` for flex col, and it is preceded by `</motion.div>` for the interactive icon. 
// Actually, let's just slice it from motionStart to the end of the relative max-w-7xl div.
const wrapperDivStart = lines.findIndex((l, i) => i > dnaSectionStart && l.includes('className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"'));
const wrapperDivEnd = dnaSectionEnd - 1; // It ends exactly before </section>
const wrapperContent = lines.slice(wrapperDivStart + 1, wrapperDivEnd);

// Add mt-8 to the motion.div's className
const classLineIdx = wrapperContent.findIndex(l => l.includes('className="relative bg-gradient-to-br'));
if (classLineIdx !== -1) {
  wrapperContent[classLineIdx] = wrapperContent[classLineIdx].replace('className="relative', 'className="relative mt-8');
}

// Remove the whole section from the original array
lines.splice(dnaSectionStart, dnaSectionEnd - dnaSectionStart + 1);

// Insert it right before the hero section ends.
const heroSectionEnd = lines.findIndex(l => l.includes('</section>'));
lines.splice(heroSectionEnd - 1, 0, ...wrapperContent);

fs.writeFileSync('c:/FareMind/src/app/page.tsx', lines.join('\n'));
console.log('Moved DNA showcase');
