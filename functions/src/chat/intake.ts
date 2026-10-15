// Deterministic repair intake. No AI. Collects: device, make/model, problem, service method, postcode, urgency.
// Answers are kept between steps (the state travels with the conversation), several can be given in one message, and any of them can be corrected or the intake restarted.
import { DEVICES, METHODS, METHODS_FOR, DEVICE_LABEL, METHOD_LABEL, Device, Method } from '../catalog'
import { correctedText, normalise } from './nlu'
import type { QuickReply } from './faq'

export interface Slots { device?: Device; manufacturer?: string; model?: string; problem?: string; method?: Method; postcode?: string; urgency?: 'flexible' | 'soon' | 'urgent' }
export type Ask = 'device' | 'manufacturer' | 'problem' | 'method' | 'postcode' | 'urgency'
export interface IntakeState { active: boolean; slots: Slots; asking?: Ask | null; confirmed?: boolean; retries?: number; modelAsked?: boolean }
export const emptyIntake = (): IntakeState => ({ active: true, slots: {}, asking: null })

const DEVICE_RULES: [RegExp, Device][] = [
  [/\bgaming (pc|computer|desktop|rig|laptop)\b|\brtx\b|\bgaming\b/, 'gaming_pc'], [/\bmac ?book|\bimac\b|\bmac (mini|pro|studio)\b|\bmac\b/, 'mac'], [/\bipad\b|\btablet\b|\bkindle\b|\bsurface go\b|\bgalaxy tab\b/, 'tablet'],
  [/\biphone\b|\bandroid\b|\bphone\b|\bmobile\b|\bgalaxy (s|a|z)\d*\b|\bpixel\b|\bsmartphone\b/, 'phone'], [/\bprinter\b|\binkjet\b|\blaserjet\b|\bscanner\b|\bphotocopier\b/, 'printer'],
  [/\blaptop\b|\bnotebook\b|\bchromebook\b|\bthinkpad\b|\bxps\b|\bpavilion\b|\binspiron\b|\blatitude\b|\bzenbook\b|\bvivobook\b|\bideapad\b|\bspectre\b|\baspire\b|\bswift\b|\bsurface (laptop|pro|book)\b/, 'laptop'],
  [/\bdesktop\b|\btower\b|\bcomputer\b|\bpc\b|\ball in one\b|\bworkstation\b|\bmini pc\b/, 'desktop'],
]
export function detectDevice(text: string): Device | null { const t = correctedText(text); for (const [re, d] of DEVICE_RULES) if (re.test(t)) return d; return null }

const BRANDS: Record<string, string> = { hp: 'HP', 'hewlett packard': 'HP', dell: 'Dell', alienware: 'Alienware', lenovo: 'Lenovo', apple: 'Apple', acer: 'Acer', asus: 'Asus', msi: 'MSI', samsung: 'Samsung', microsoft: 'Microsoft', razer: 'Razer', huawei: 'Huawei', toshiba: 'Toshiba', sony: 'Sony', canon: 'Canon', epson: 'Epson', brother: 'Brother', google: 'Google', oneplus: 'OnePlus', xiaomi: 'Xiaomi', lg: 'LG', gigabyte: 'Gigabyte', medion: 'Medion', fujitsu: 'Fujitsu', panasonic: 'Panasonic', motorola: 'Motorola', nokia: 'Nokia', oppo: 'Oppo', honor: 'Honor', cyberpowerpc: 'CyberPowerPC', 'packard bell': 'Packard Bell' }
const FAMILY_BRAND: Record<string, string> = { pavilion: 'HP', envy: 'HP', spectre: 'HP', elitebook: 'HP', probook: 'HP', omen: 'HP', thinkpad: 'Lenovo', ideapad: 'Lenovo', yoga: 'Lenovo', legion: 'Lenovo', xps: 'Dell', inspiron: 'Dell', latitude: 'Dell', vostro: 'Dell', precision: 'Dell', macbook: 'Apple', imac: 'Apple', iphone: 'Apple', ipad: 'Apple', surface: 'Microsoft', zenbook: 'Asus', vivobook: 'Asus', rog: 'Asus', aspire: 'Acer', swift: 'Acer', nitro: 'Acer', predator: 'Acer', galaxy: 'Samsung', pixel: 'Google', laserjet: 'HP', officejet: 'HP', pixma: 'Canon', ecotank: 'Epson' }
export const COMMON_BRANDS: Record<string, string[]> = { laptop: ['HP', 'Dell', 'Lenovo', 'Apple', 'Acer', 'Asus'], desktop: ['HP', 'Dell', 'Lenovo', 'Acer', 'Asus', 'Apple'], gaming_pc: ['Alienware', 'MSI', 'Asus', 'Dell', 'HP', 'Custom build'], mac: ['Apple'], phone: ['Apple', 'Samsung', 'Google', 'OnePlus', 'Huawei', 'Xiaomi'], tablet: ['Apple', 'Samsung', 'Microsoft', 'Lenovo', 'Amazon'], printer: ['HP', 'Canon', 'Epson', 'Brother'], other: ['HP', 'Dell', 'Apple', 'Samsung'] }
const NOT_MODEL = new Set('the a an is are was were it its my our keeps keep won will not wont cant cannot and or but with has have had been being very really just since after when while that this these those from for to in on at of laptop laptops desktop computer pc phone tablet printer mac slow broken cracked screen battery dead turning shutting restarting freezing crashing stopped stopping no yes please thanks i im ive id we you what why how'.split(' '))
const SKIP = /^(skip|dont know|do not know|not sure|unsure|no idea|idk|unknown|n a|na|none|dunno|cant remember|cannot remember)$/

/** Brand and model from free text. Model = up to three following words that look like model names. */
export function detectMake(text: string): { manufacturer?: string; model?: string } {
  const words = text.replace(/[,;:!?()"]/g, ' ').split(/\s+/).filter(Boolean), lower = words.map(w => w.toLowerCase().replace(/[^a-z0-9-]/g, ''))
  let bi = -1, brand = ''
  for (let i = 0; i < lower.length; i++) {
    const two = `${lower[i]} ${lower[i + 1] ?? ''}`
    if (BRANDS[two]) { bi = i + 1; brand = BRANDS[two]; break }
    if (BRANDS[lower[i]]) { bi = i; brand = BRANDS[lower[i]]; break }
  }
  let start = bi + 1
  if (bi < 0) { const fi = lower.findIndex(w => FAMILY_BRAND[w]); if (fi < 0) return {}; brand = FAMILY_BRAND[lower[fi]]; bi = fi; start = fi }   // "pavilion" implies HP
  const model: string[] = []
  for (let i = start; i < words.length && model.length < 3; i++) { const w = lower[i]; if (!w || NOT_MODEL.has(w) || BRANDS[w]) break; model.push(words[i].replace(/[^A-Za-z0-9-]/g, '')); if (/[.,;]$/.test(words[i])) break }
  return { manufacturer: brand, model: model.join(' ').trim() || undefined }
}

const SYMPTOMS = /\b(won'?t|will not|doesn'?t|does not|not|cannot|can'?t|no) (turn|switch|power|boot|start|charge|work|connect|load|print|display|show|respond|detect|read)|\b(deadpc|shutdown|dead|broken|cracked|smashed|shattered|flicker|black screen|blank screen|blue screen|overheat|overheating|too hot|noisy|loud fan|beeping|clicking|slow|sluggish|freez|frozen|crash|lag|restart|reboot|shut ?down|shuts? off|switch(es|ing)? off|turns? off|virus|malware|pop ?ups?|hacked|spyware|ransomware|battery|charger|charging|keyboard|trackpad|touchpad|usb port|wifi|wi-?fi|internet|bluetooth|water|spilled|spill|liquid|dropped|drop|data|files?|hard drive|ssd|paper jam|jam|ink|toner|scan|error|problem|issue|fault|stopped|stuck|update|windows|noise|smell|burning|lines|pixel)\b/i
export const hasSymptom = (t: string) => SYMPTOMS.test(correctedText(t))

export const COMMON_SYMPTOMS: Record<string, string[]> = {
  laptop: ['Won’t turn on', 'Slow or freezing', 'Cracked or faulty screen', 'Battery or charging', 'Overheating or loud fan', 'Virus or pop-ups'],
  desktop: ['Won’t turn on', 'Slow or freezing', 'No picture on screen', 'Overheating or loud fan', 'Virus or pop-ups', 'Data recovery'],
  gaming_pc: ['Won’t turn on', 'Crashing during games', 'Overheating or loud fan', 'No picture on screen', 'Upgrade parts', 'Virus or pop-ups'],
  mac: ['Won’t turn on', 'Slow or freezing', 'Cracked or faulty screen', 'Battery or charging', 'Liquid damage', 'Data recovery'],
  phone: ['Cracked screen', 'Battery or charging', 'Won’t turn on', 'Liquid damage', 'Slow or freezing', 'Data recovery'],
  tablet: ['Cracked screen', 'Battery or charging', 'Won’t turn on', 'Slow or freezing', 'Liquid damage'],
  printer: ['Paper jams', 'Won’t print', 'Won’t connect to wifi', 'Poor print quality', 'Scanner problem'],
  other: ['Won’t turn on', 'Slow or freezing', 'Network or wifi problem', 'Virus or pop-ups', 'Data recovery'],
}

export const detectMethod = (text: string): Method | null => {
  const t = correctedText(text)
  if (/\bhomevisit\b|\bhome visit\b|\bcome to (me|my|us)\b|\bat (my )?(home|house|place)\b|\bvisit me\b|\bcome out\b|\bon ?site\b/.test(t) || /^home$/.test(t.trim())) return 'home'
  if (/\boffice\b|\bbusiness premises\b|\bmy (shop|business|company)\b/.test(t)) return 'office'
  if (/\bremote(ly)?\b|\bonline\b|\bover the (phone|internet)\b|\bscreen share\b/.test(t)) return 'remote'
  if (/\bcollect(ion)?\b|\bpick(ed)? ?up\b|\breturn\b|\bcourier\b/.test(t)) return 'collection'
  if (/\bworkshop\b|\bbring (it )?(in|to)\b|\bdrop (it )?off\b|\bshop\b/.test(t)) return 'workshop'
  return null
}
export const detectUrgency = (text: string): 'flexible' | 'soon' | 'urgent' | null => {
  const t = correctedText(text)
  if (/\burgent(ly)?\b|\basap\b|\bemergency\b|\btoday\b|\bimmediately\b|\bright now\b|\bsame day\b/.test(t)) return 'urgent'
  if (/\bsoon\b|\bthis week\b|\bfew days\b|\bquick(ly)?\b|\bnext few\b|\bwithin a week\b/.test(t)) return 'soon'
  if (/\bflexible\b|\bno rush\b|\bwhenever\b|\bnot urgent\b|\bno hurry\b|\bany ?time\b|\bnot in a hurry\b/.test(t)) return 'flexible'
  return null
}
export function detectPostcode(text: string): string | null {
  const m = text.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/); return m ? `${m[1]} ${m[2]}` : null
}

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|please|go ahead|do it|y|correct|that is right|sounds good|lets do it|let us do it|why not)$/
const NO = /^(no|nope|nah|not now|no thanks|n|later|maybe later)$/
export const isYes = (t: string) => YES.test(normalise(t)), isNo = (t: string) => NO.test(normalise(t))
export const isSkip = (t: string) => SKIP.test(normalise(t))
export const isRestart = (t: string) => /\b(start over|start again|restart|begin again|reset|never ?mind|forget it|scrap that|cancel (this|the) (request|chat|form))\b/.test(normalise(t))
export const isQuestion = (t: string) => /\?\s*$/.test(t.trim()) || /^(how|what|when|where|why|who|can|could|do|does|did|is|are|will|would|should|which)\b/.test(normalise(t))

const SLOT_WORDS: [Ask, RegExp][] = [['device', /\b(device|type|laptop|computer)\b/], ['manufacturer', /\b(make|maker|manufacturer|brand|model)\b/], ['problem', /\b(problem|issue|symptom|fault|description|what is wrong)\b/], ['method', /\b(method|service|visit|how|repair type|where)\b/], ['postcode', /\b(postcode|post code|zip|location|address|area)\b/], ['urgency', /\b(urgency|urgent|how soon|when)\b/]]
/** "change the postcode" / "edit the model" -> which slot, or null. */
export function changeTarget(text: string): Ask | null {
  const t = normalise(text); if (!/\b(change|edit|correct|fix|update|wrong|actually|amend|different)\b/.test(t)) return null
  for (const [slot, re] of SLOT_WORDS) if (re.test(t)) return slot
  return null
}

export const nextAsk = (s: Slots, st: IntakeState): Ask | null =>
  !s.device ? 'device' : !s.manufacturer ? 'manufacturer' : !s.problem ? 'problem' : !s.method ? 'method' : !s.postcode ? 'postcode' : !s.urgency ? 'urgency' : null

export function allowedMethods(device?: Device): Method[] { return [...(METHODS_FOR[device ?? 'other'] ?? METHODS)] }

export function question(ask: Ask, s: Slots, retry = false): { text: string; quick: QuickReply[] } {
  const q = (label: string, value = label): QuickReply => ({ label, value })
  switch (ask) {
    case 'device': return { text: retry ? 'Which of these is it? You can tap one or type it.' : 'What needs repairing?', quick: DEVICES.map(d => q(DEVICE_LABEL[d], DEVICE_LABEL[d])) }
    case 'manufacturer': return { text: retry ? 'Please give the make, and the model if you know it (for example “Dell XPS 13”), or say “don’t know”.' : `Which make and model is the ${s.device ? DEVICE_LABEL[s.device].toLowerCase() : 'device'}? For example “HP Pavilion 15”. You can say “don’t know”.`, quick: [...(COMMON_BRANDS[s.device ?? 'other'] ?? []).map(b => q(b)), q('Don’t know')] }
    case 'problem': return { text: retry ? 'Could you describe it in a few words? For example “screen is cracked” or “shuts down after ten minutes”.' : 'What’s it doing? A few words are fine.', quick: [...(COMMON_SYMPTOMS[s.device ?? 'other'] ?? []).map(x => q(x)), q('Something else')] }
    case 'method': return { text: retry ? `That option isn’t available for a ${s.device ? DEVICE_LABEL[s.device].toLowerCase() : 'device'}. Please pick one of these.` : 'How would you like it repaired?', quick: allowedMethods(s.device).map(m => q(METHOD_LABEL[m])) }
    case 'postcode': return { text: retry ? 'That doesn’t look like a UK postcode. It should look like “E15 1AA”.' : 'What’s your postcode? Engineers only see the approximate area until you choose one.', quick: [] }
    case 'urgency': return { text: 'How urgent is it?', quick: [q('Flexible'), q('Soon (within a few days)'), q('Urgent')] }
  }
}

/** Pull every slot we can out of one message (customers often give several at once). `asking` lets short bare answers ("Dell", "E15 1AA", "home") be understood. */
export function extract(text: string, asking: Ask | null, current: Slots): { patch: Slots; understoodAsked: boolean } {
  const patch: Slots = {}, t = text.trim().slice(0, 500)
  const device = detectDevice(t); if (device) patch.device = device
  const pc = detectPostcode(t); if (pc) patch.postcode = pc
  const m = detectMethod(t); if (m) patch.method = m
  const u = detectUrgency(t); if (u) patch.urgency = u
  const make = detectMake(t); if (make.manufacturer) { patch.manufacturer = make.manufacturer; if (make.model) patch.model = make.model }
  if (asking === 'device') { const lab = (Object.keys(DEVICE_LABEL) as Device[]).find(d => normalise(DEVICE_LABEL[d]) === normalise(t)); if (lab) patch.device = lab }
  if (asking === 'manufacturer' && !patch.manufacturer) {
    if (isSkip(t)) { patch.manufacturer = 'Unknown' }
    else if (t.length <= 60 && t.split(/\s+/).length <= 4 && /^[A-Za-z0-9][A-Za-z0-9 .\-+/]*$/.test(t) && !detectDevice(t)) { const [first, ...rest] = t.split(/\s+/); patch.manufacturer = first.charAt(0).toUpperCase() + first.slice(1); if (rest.length) patch.model = rest.join(' ') }
  }
  if (asking === 'problem' && !isSkip(t) && normalise(t).length >= 4 && !isQuestion(t) && !/^(something else|other)$/.test(normalise(t))) patch.problem = t
  else if (hasSymptom(t) && !isQuestion(t) && (!asking || asking === 'problem' || t.split(/\s+/).length >= 4)) patch.problem = patch.problem ?? t
  if (asking === 'urgency' && !patch.urgency) { const n = normalise(t); if (isSkip(t) || /^(flexible|whenever|any)/.test(n)) patch.urgency = 'flexible' }
  // a quick-reply label for "something else" asks for words instead
  const understoodAsked = asking ? (asking === 'device' ? !!patch.device : asking === 'manufacturer' ? !!patch.manufacturer : asking === 'problem' ? !!patch.problem : asking === 'method' ? !!patch.method : asking === 'postcode' ? !!patch.postcode : !!patch.urgency) : Object.keys(patch).length > 0
  void current
  return { patch, understoodAsked }
}

export function summary(s: Slots): string {
  const make = [s.manufacturer, s.model].filter(Boolean).join(' ')
  return [`Device: ${s.device ? DEVICE_LABEL[s.device] : '?'}${make ? ` (${make})` : ''}`, `Problem: ${s.problem ?? '?'}`, `Service: ${s.method ? METHOD_LABEL[s.method] : '?'}`, `Postcode: ${s.postcode ?? '?'}`, `Urgency: ${s.urgency === 'urgent' ? 'Urgent' : s.urgency === 'soon' ? 'Soon' : 'Flexible'}`].join('\n')
}
/** The existing repair form's own fields; the customer still reviews and submits it themselves. */
export const toDraft = (s: Slots) => ({ device: s.device, manufacturer: s.manufacturer === 'Unknown' ? undefined : s.manufacturer, model: s.model, problem: s.problem, serviceMethods: s.method ? [s.method] : [], postcode: s.postcode, urgency: s.urgency ?? 'flexible' })
export const isComplete = (s: Slots) => !!(s.device && s.manufacturer && s.problem && s.method && s.postcode)
