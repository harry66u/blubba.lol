/**
 * Username rules and filtering (spec §13). Most players are under 18, so the filter errs on the
 * side of blocking: a false positive just means picking another name.
 *
 * Names are normalized before matching: lowercased, leetspeak folded (0->o, 1->i, 3->e, 4->a,
 * 5->s, 7->t, @->a, $->s, !->i), separators removed, and repeated letters collapsed, so
 * "B.u.t.t" and "buuuutt" match "butt".
 */

// Blocked anywhere inside a name (after normalization). Long enough to rarely hit innocent words.
const SUBSTRINGS = [
  // profanity
  'fuck', 'fuk', 'fuq', 'phuck', 'fck', 'shit', 'shyt', 'bitch', 'biatch', 'bastard', 'asshole', 'arsehole', 'dumbass', 'jackass',
  'dick', 'cock', 'pussy', 'cunt', 'twat', 'wank', 'bollock', 'bullshit', 'motherf', 'damnit', 'goddam', 'piss',
  'crap', 'douche', 'slut', 'whore', 'hoe', 'skank', 'thot', 'milf', 'dildo', 'jizz', 'cum', 'semen', 'sperm',
  // sexual
  'sex', 'porn', 'prn', 'pron', 'nude', 'naked', 'boob', 'tits', 'titty', 'titties', 'nipple', 'penis', 'vagina', 'vulva', 'clit',
  'anal', 'anus', 'orgasm', 'horny', 'erect', 'boner', 'blowjob', 'handjob', 'rimjob', 'bj', 'hentai', 'rape', 'rapist', 'molest',
  'pedo', 'paedo', 'incest', 'fetish', 'bdsm', 'kinky', 'stripper', 'hooker', 'escort', 'onlyfans', 'nsfw', 'xxx', 'deepthroat',
  'ejacul', 'masturb', 'fap', 'grope', 'humping', 'hump', 'sexy', 'seggs', 'smex', 'lewd', 'thicc', 'daddy', 'mommy', 'bussy',
  'coochie', 'cooch', 'vag', 'pp', 'weiner', 'wiener', 'schlong', 'ballsack', 'nutsack', 'scrotum', 'testicle', 'genital', 'groin',
  'butthole', 'buttplug', 'queef', 'smegma', 'condom', 'viagra', 'sugar daddy', 'furry', 'yiff', 'e621', 'r34', 'rule34',
  // slurs and hate (kept as roots)
  'nigg', 'nigga', 'niga', 'nigr', 'negro', 'n1gg', 'chink', 'gook', 'spic', 'spick', 'wetback', 'beaner', 'kike', 'kyke', 'raghead',
  'towelhead', 'sandnig', 'coon', 'jigaboo', 'porchmonkey', 'junglebunny', 'paki', 'wop', 'dago', 'gyp', 'gypsy', 'tranny',
  'faggot', 'fag', 'fagg', 'dyke', 'homo', 'queer', 'retard', 'retrd', 'tard', 'spaz', 'mongoloid', 'cripple', 'midget',
  'nazi', 'hitler', 'heil', 'kkk', 'klan', 'swastik', 'holocaust', 'isis', 'jihad', 'terrorist', 'genocide', 'lynch', 'whitepower',
  'white power', 'wpww', '1488', 'siegheil', 'aryan',
  // violence / self-harm / drugs
  'kys', 'killyourself', 'suicide', 'selfharm', 'cutmyself', 'schoolshoot', 'massacre', 'murder', 'behead',
  'cocaine', 'coke', 'heroin', 'meth', 'crack', 'weed', 'stoner', 'blunt', 'bong', 'vape', 'xanax', 'fentanyl', 'lsd',
  // compound insults
  'fatass', 'bigass', 'asskick', 'asswipe', 'kissmyass', 'buttface', 'butthead', 'buttmunch', 'assclown', 'asshat',
  // impersonation
  'admin', 'moderator', 'official', 'bubbastaff', 'blubbastaff', 'developer', 'support',
];

// Blocked only as a whole word (so "class", "Scunthorpe"-style names still work).
const WORDS = ['ass', 'arse', 'butt', 'balls', 'nuts', 'sucks', 'suck', 'hell', 'damn', 'bum', 'poop', 'pee', 'mod', 'dev', 'staff', 'nut', 'tit', 'gay', 'jew', 'jap', 'die', 'kill'];

// Common innocent words that contain blocked substrings; these are removed before matching.
const ALLOWED = [
  'class', 'grass', 'glass', 'pass', 'bass', 'mass', 'sassy', 'cockpit', 'peacock', 'hancock', 'shuttle', 'cocktail', 'scunthorpe',
  'shoe', 'hoedown', 'phoenix', 'shoes', 'cucumber', 'circumstance', 'document', 'scum', 'accumulate', 'cumulus', 'analog',
  'analysis', 'canal', 'banana', 'hampshire', 'shiitake', 'matsushita', 'dickens', 'moby dick', 'cockatoo', 'cockatiel',
  'crapper', 'therapist', 'grape', 'drape', 'scrape', 'rapeseed', 'hippo', 'supper', 'happy', 'puppy', 'apple', 'pepper',
  'hippie', 'pipe', 'sleepy', 'poppy', 'skipper', 'dipper', 'flipper', 'zipper', 'upper', 'copper', 'hopper', 'shopper',
  'snapper', 'kipper', 'pupper', 'popping', 'pumpkin', 'bump', 'thumper', 'coconut', 'cocoa', 'spice', 'spicy', 'skunk',
  'recoon', 'raccoon', 'tycoon', 'cocoon', 'cartoon', 'typhoon', 'monsoon', 'balloon', 'saloon', 'maroon', 'lagoon', 'spoon',
  'moon', 'soon', 'noon', 'bayou', 'hoedown', 'shoebox', 'toe', 'hoes', 'wishbone', 'terracotta', 'cracker', 'crackle', 'weedle',
  'pineapple', 'uppercut', 'ripper', 'wrapper', 'rapper', 'trapper', 'slipper', 'stripe', 'mishap', 'skipped',
  'glasses', 'assassin', 'bassoon', 'compass', 'embassy', 'passion', 'massive', 'lasso', 'molasses', 'cassette', 'grasshopper',
  'button', 'butter', 'butterfly', 'buttercup', 'mutt', 'hellen', 'shell', 'hello', 'michelle',
  'homer', 'homework', 'homestead', 'homerun', 'method', 'something', 'blunted', 'savage', 'ravage', 'vagabond', 'direct',
  'tweed', 'egypt', 'scrap', 'apron', 'pronto', 'pronounce', 'prong', 'suspicious', 'auspicious', 'conspicuous', 'crisis',
  'turkey', 'dijon', 'dicey', 'kingdom', 'wiki', 'sussex', 'essex', 'middlesex', 'unisex', 'fagot', 'tardis', 'mustard',
  'custard', 'bastion', 'retardant', 'spacey', 'pakistan', 'gypsum', 'swopt', 'coonhound', 'isisa', 'shooters', 'supporter',
];

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '6': 'g',
  '2': 'z', '€': 'e', '£': 'l', 'ß': 'ss', 'µ': 'u',
};

function foldLeet(s: string): string {
  let out = '';
  for (const ch of s) out += LEET[ch] ?? ch;
  return out;
}

/** Lowercase, strip accents, fold leetspeak, keep letters and spaces only. */
export function normalizeName(raw: string): string {
  const lower = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return foldLeet(lower).replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function collapseRepeats(s: string): string {
  return s.replace(/(.)\1+/g, '$1');
}

const allowedPatterns = ALLOWED.map((w) => w.replace(/ /g, ''));

/** True if the name contains anything we don't allow. */
export function isNameBlocked(raw: string): boolean {
  const norm = normalizeName(raw);
  if (!norm) return false;
  const words = norm.split(' ');
  const joined = words.join('');
  // Digit-only tricks like 1488 are checked on the raw string too.
  const rawDigits = raw.replace(/[^0-9]/g, '');
  if (rawDigits.includes('1488') || rawDigits === '88' || rawDigits.includes('69') || rawDigits.includes('420')) return true;

  for (const w of words) {
    const c = collapseRepeats(w);
    if (WORDS.includes(w) || WORDS.includes(c) || WORDS.some((b) => w === b + 's' || c === b + 's')) return true;
  }

  const variants = new Set([joined, collapseRepeats(joined)]);
  for (let v of variants) {
    for (const ok of allowedPatterns) v = v.split(ok).join('_');
    for (const bad of SUBSTRINGS) {
      const b = bad.replace(/ /g, '');
      if (b.length <= 2) {
        // Very short roots (bj, pp) only count as whole words.
        if (words.includes(b)) return true;
        continue;
      }
      if (v.includes(b)) return true;
    }
  }
  return false;
}

export interface NameCheck {
  ok: boolean;
  name: string;
  reason?: string;
}

/** Validates and tidies a player-chosen name. */
export function checkName(raw: string): NameCheck {
  const name = raw.replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 3) return { ok: false, name, reason: 'Names need at least 3 letters or numbers.' };
  if (name.length > 16) return { ok: false, name, reason: 'Names can be at most 16 characters.' };
  if (!/[A-Za-z]/.test(name)) return { ok: false, name, reason: 'Names need at least one letter.' };
  if (isNameBlocked(name)) return { ok: false, name, reason: "That name isn't allowed. Try another one." };
  return { ok: true, name };
}

const ADJECTIVES = [
  'Wobbly', 'Floppy', 'Puffy', 'Bouncy', 'Squeaky', 'Gusty', 'Zippy', 'Wiggly', 'Breezy', 'Jumpy', 'Loopy', 'Snappy', 'Fizzy',
  'Rubbery', 'Swirly', 'Twirly', 'Bendy', 'Noodly', 'Flappy', 'Zoomy', 'Spiffy', 'Goofy', 'Jolly', 'Peppy',
];
const NOUNS = [
  'Noodle', 'Tube', 'Balloon', 'Blimp', 'Gust', 'Breeze', 'Flapper', 'Wiggler', 'Puff', 'Bubble', 'Zephyr', 'Twister',
  'Flail', 'Pump', 'Whoosh', 'Squeak', 'Floater', 'Bouncer', 'Tornado', 'Cyclone', 'Kite', 'Waver',
];

/** Random safe guest name such as "Wobbly Noodle 42" (max 16 chars). */
export function randomGuestName(rng: () => number = Math.random): string {
  for (let i = 0; i < 20; i++) {
    const a = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)];
    const n = NOUNS[Math.floor(rng() * NOUNS.length)];
    const num = Math.floor(rng() * 90 + 10);
    const name = `${a}${n}${num}`;
    if (name.length <= 16 && checkName(name).ok) return name;
  }
  return `Tube${Math.floor(rng() * 9000 + 1000)}`;
}
