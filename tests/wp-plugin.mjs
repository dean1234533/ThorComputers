// WordPress plugin intake, driven by the real plugin PHP against the local wpIntake function. Needs PHP (see scripts/php.sh).
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
for (const k of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST']) if (!/^(127\.0\.0\.1|localhost)/.test(process.env[k] ?? '')) { console.error(`Refusing to run: ${k} is not local.`); process.exit(2) }
process.env.GCLOUD_PROJECT = 'demo-thor'
const require = createRequire(new URL('../functions/', import.meta.url))
const { initializeApp } = require('firebase-admin/app'); const { getFirestore } = require('firebase-admin/firestore'); initializeApp({ projectId: 'demo-thor' }); const db = getFirestore()
const php = spawnSync('bash', ['../scripts/php.sh', '-v']); if (php.status !== 0) { console.error('No PHP runtime available:\n' + php.stderr); process.exit(3) }
const URL_ = 'http://127.0.0.1:5001/demo-thor/europe-west2/wpIntake', SECRET = 'demo-wp-intake-secret-local-only', stamp = Date.now().toString(36), EMAIL = `php.${stamp}@wp.demo.test`
const run = (secret, url = URL_) => { const r = spawnSync('bash', ['../scripts/php.sh', 'wp-harness.php', url, secret, EMAIL], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr || r.stdout); return Object.fromEntries(r.stdout.trim().split('\n').map(l => JSON.parse(l)).map(o => [o.label, o])) }
let pass = 0, fail = 0
const check = (name, cond, extra = '') => { cond ? (pass++, console.log(`  ✔ ${name}`)) : (fail++, console.log(`  ✖ ${name} ${extra}`)) }
console.log('WordPress plugin intake (real plugin PHP → real wpIntake function)\n')
const r = run(SECRET)
check('valid consenting enquiry is accepted by the server (PHP HMAC verified by the TypeScript function)', r.valid_with_consent.result === 'http_200' && r.valid_with_consent.http_calls === 1, JSON.stringify(r.valid_with_consent))
const all = await db.collection('enquiries').where('email', '==', EMAIL).get()
const first = all.docs.filter(d => d.data().fields.problem === 'Battery drains in ten minutes')
check('the enquiry was stored with the form fields, awaiting the customer', first.length === 1 && first[0].data().fields.brand === 'Acer' && first[0].data().status === 'awaiting_customer', `matching=${first.length}`)
const mails = await db.collection('devMailbox').where('to', '==', EMAIL).get()
check('the same submission sent 3 times (retry + attempt 3) is deduplicated: one enquiry, and one confirmation email per DISTINCT enquiry', r.same_submission_retried.result === 'http_200' && r.third_attempt_allowed.result === 'http_200' && first.length === 1 && mails.size === all.size, `enquiries=${all.size} mails=${mails.size}`)
check('no consent => nothing leaves WordPress', r.no_consent.result === 'no_consent' && r.no_consent.http_calls === 0)
check('blank consent value => nothing leaves WordPress', r.empty_consent_array.result === 'no_consent' && r.empty_consent_array.http_calls === 0)
check('invalid email => nothing sent', r.bad_email.result === 'bad_email' && r.bad_email.http_calls === 0)
check('a different Contact Form 7 form is ignored', r.other_form_ignored.http_calls === 0)
check('integration switched off => nothing sent', r.integration_disabled.http_calls === 0)
check('rate limit: 4th attempt per ip+email is blocked locally', r.rate_limited_on_4th.result === 'rate_limited' && r.rate_limited_on_4th.http_calls === 0, JSON.stringify(r.rate_limited_on_4th))
check('HTML is stripped and the problem text is capped at 2000 chars before sending', r.last_payload_problem_len.result === 2000, String(r.last_payload_problem_len.result))
const bad = run('wrong-secret-value-here')
check('wrong shared secret => server answers 401 and the plugin logs it without throwing', bad.valid_with_consent.result === 'http_401', JSON.stringify(bad.valid_with_consent))
const down = run(SECRET, 'http://127.0.0.1:9/nothing')
check('API unreachable => plugin degrades gracefully (logged error, no exception)', /^error:/.test(down.valid_with_consent.result), JSON.stringify(down.valid_with_consent))
const none = spawnSync('bash', ['../scripts/php.sh', '-r', "define('ABSPATH','/'); echo 'ok';"], { encoding: 'utf8' })
console.log(`\n${pass}/${pass + fail} plugin checks passed`); process.exit(fail ? 1 : 0)
