import crypto from 'node:crypto';
import { HEALTH_NAVIGATOR_MODEL } from './ai-models.js';
import { overviewAccess, readOverviewRecord } from './health-overview.js';
import { lifestyleContext, localLifestylePlan } from './lifestyle-plan.js';
import { calculateBMI } from '../../../assets/bmi.js';
import { medicalEvidenceByIds, medicalEvidencePrompt, resolveMedicalSources, validGroundedText } from './medical-evidence.js';
import { InputValidationError, numberField } from './validate.js';

export const WELLNESS_VERSION = 'wellness-v1';
export const WELLNESS_KINDS = ['nutrition', 'skin_hair'];
const commonEnums = { pregnancy_status: ['unknown','no','yes','possible'] };
const nutritionEnums = { goal: ['maintain','gradual_loss','gradual_gain'], dietary_pattern: ['balanced','vegetarian','vegan','pescatarian','other'], budget: ['economy','standard','flexible'], cooking_time: ['quick','moderate','flexible'], activity_level: ['limited','low','moderate','high'] };
const skinEnums = { skin_type: ['dry','oily','combination','normal','unknown'], scalp_type: ['unknown','normal','dry','oily','flaky'], skin_sensitivity: ['yes','no','unknown'], urgent_symptoms: ['none','yes','not_sure'] };
const freeFields = { nutrition: ['preferences','dislikes','meal_schedule','additional_allergies','medical_restrictions'], skin_hair: ['skin_concerns','current_products','additional_allergies','hair_scalp_concerns','duration','urgent_details'] };
const clean = value => String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
const norm = value => clean(value).normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = (kind, record, answers, evidence) => crypto.createHash('sha256').update(JSON.stringify(canonical({ kind, record, answers, version: WELLNESS_VERSION, evidence: evidence.version }))).digest('hex');
export function wellnessAnswers(kind, input) {
  if (!WELLNESS_KINDS.includes(kind) || !input || typeof input !== 'object' || Array.isArray(input)) throw new InputValidationError('نوع برنامه یا پاسخ‌های پرسشنامه معتبر نیست.');
  const enums = { ...commonEnums, ...(kind === 'nutrition' ? nutritionEnums : skinEnums) }, allowed = new Set([...Object.keys(enums), ...freeFields[kind], ...(kind === 'nutrition' ? ['target_weight_kg'] : [])]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new InputValidationError('پرسشنامه شامل گزینهٔ ناشناخته است.');
  const output = {};
  for (const [key, choices] of Object.entries(enums)) {
    const value = input[key] ?? (['pregnancy_status','scalp_type'].includes(key) ? 'unknown' : undefined);
    if (!choices.includes(value)) throw new InputValidationError('گزینه‌های پرسشنامه را کامل و دوباره بررسی کنید.');
    output[key] = value;
  }
  for (const field of freeFields[kind]) {
    if (input[field] != null && typeof input[field] !== 'string') throw new InputValidationError('پاسخ متنی پرسشنامه معتبر نیست.');
    const value = clean(input[field]); if (value.length > 600) throw new InputValidationError('هر پاسخ متنی باید کوتاه‌تر از ۶۰۰ نویسه باشد.'); output[field] = value;
  }
  if (kind === 'nutrition') output.target_weight_kg = numberField(input.target_weight_kg, { label: 'وزن دلخواه', min: .2, max: 500 });
  else if (!output.skin_concerns && !output.hair_scalp_concerns) throw new InputValidationError('حداقل موضوع پوست یا موی خود را بنویسید.');
  return output;
}
export function wellnessClinicalRecord(record) {
  return { patient: record.patient, conditions: record.conditions.slice(0,10), allergies: record.allergies.slice(0,15), medications: record.medications.slice(0,10), vitals: record.vitals.slice(0,3), tests: record.tests.slice(0,3).map(test => ({ ...test, items: (test.items || []).slice(0,10) })), encounters: record.encounters.slice(0,2), tasks: [], source_window: 'حداکثر سه آزمایش و سه اندازه‌گیری اخیر و بخشی از سوابق ثبت‌شده؛ پرونده و پاسخ‌ها ممکن است ناقص باشند.' };
}
function contextFor(record, answers) {
  const merged = { ...record, patient: { ...record.patient }, conditions: [...record.conditions] };
  if (!['yes','possible'].includes(merged.patient.pregnancy_status) && answers.pregnancy_status !== 'unknown') merged.patient.pregnancy_status = answers.pregnancy_status;
  if (answers.medical_restrictions) merged.conditions.push({ name: answers.medical_restrictions, status: 'active' });
  const weight=record.vitals.find(row=>row.weight_kg)?.weight_kg,height=record.patient.height_cm;
  const risk = lifestyleContext(merged), roundedBMI=calculateBMI(weight,height),bmi=roundedBMI===null?null:Number(weight)/((Number(height)/100)**2);
  const eatingDisorder = /اختلال.{0,8}خوردن|بی.?اشتهایی عصبی|پرخوری عصبی|anorexi|bulimi|eating.?disorder/i.test(merged.conditions.map(row => row.name).join(' '));
  const vulnerable = risk.kidney || risk.cardiac || risk.child || risk.ageUnknown || risk.pregnancy || risk.unknownPregnancy || risk.critical || eatingDisorder || (bmi !== null && bmi < 18.5);
  const symptomText=norm([answers.urgent_details,answers.skin_concerns,answers.hair_scalp_concerns].filter(Boolean).join('؛ ')).split(/[؛،.!؟\n]|اما|ولی/).filter(clause=>!/(?:ندارم|ندارد|نیست|بدون)/.test(clause)).join('؛ ');
  const urgent = ['yes','not_sure'].includes(answers.urgent_symptoms) || /تورم.{0,12}(?:صورت|لب|زبان)|تاول.{0,10}(?:گسترده|شدید)|اختلال.{0,8}تنفس|تنگی نفس|خال.{0,30}(?:خون.?ریزی|خونریزی|بزرگ|تغییر)|(?:قرمزی|سرخی).{0,30}(?:گسترش|دردناک|شدید)|زخم.{0,20}(?:چرک|خون.?ریزی)|ریزش.{0,15}(?:ناگهانی|لکه.?ای)/.test(symptomText);
  return { record: merged, risk, eatingDisorder, bmi, vulnerable, urgent };
}
export function wellnessEvidence(kind, record, answers) {
  const { risk } = contextFor(record, answers);
  const ids = kind === 'skin_hair' ? ['aad_basic_skin','aad_product_test','aad_hair_care'] : ['who_healthy_diet', ...(risk.kidney ? ['niddk_ckd_diet'] : []), ...(risk.diabetes || risk.glucose ? ['medline_glucose'] : []), ...(risk.lipids ? ['medline_lipids'] : [])];
  return medicalEvidenceByIds(ids);
}
function allowedFood(text, allergyText, dislikes) {
  const allergy = norm(allergyText), dislike = norm(dislikes);
  const groups = [ [/شیر|لبنی|لاکتوز|dairy|milk/i, /شیر|ماست|پنیر|لبنی/], [/تخم.?مرغ|egg/i, /تخم.?مرغ/], [/گندم|گلوتن|wheat|gluten|سلیاک|celiac|coeliac/i, /نان|گندم|جو|بلغور/], [/عدس|نخود|لوبیا|حبوبات|legume|lentil|chickpea|bean/i,/عدس|نخود|لوبیا|حبوبات/], [/ماهی|دریایی|fish|seafood/i, /ماهی/], [/مغز|بادام|پسته|آجیل|گردو|nut/i, /بادام|پسته|آجیل|گردو|مغز/], [/سویا|soy/i, /سویا|توفو/] ];
  if (groups.some(([trigger, food]) => trigger.test(allergy) && food.test(text))) return false;
  const terms = (allergy + '،' + dislike).split(/[،,;\n]/).map(term => term.trim()).filter(term => term.length >= 2 && term.length < 50);
  return !terms.some(term => norm(text).includes(term));
}
function matchesDiet(text,pattern) {
  if(pattern==='balanced'||pattern==='other')return true;
  const meatText=norm(text).replace(/تخم\s*مرغ|eggs?/ig,'');
  if(/مرغ|جوجه|گوشت|کباب|سوسیس|کالباس|بیکن|chicken|beef|meat|pork|bacon/i.test(meatText))return false;
  if(pattern!=='pescatarian'&&/ماهی|میگو|دریایی|fish|shrimp|seafood/i.test(text))return false;
  return pattern!=='vegan'||!/شیر|ماست|پنیر|لبنی|کره|تخم.?مرغ|عسل|milk|dairy|yog[hu]urt|cheese|butter|egg|honey/i.test(text);
}
export function localWellnessProgram(kind, record, answers, pack = wellnessEvidence(kind, record, answers)) {
  const context = contextFor(record, answers), lifestyle = localLifestylePlan(context.record);
  const allergies = [...record.allergies.map(row => row.allergen), answers.additional_allergies].filter(Boolean).join('، ');
  const common = { title: kind === 'nutrition' ? 'برنامهٔ شروع تغذیهٔ متناسب با شرایط شما' : 'روتین ساده و محتاطانهٔ پوست و مو',
    summary: 'این برنامهٔ آموزشی از اطلاعات همین پرونده و پاسخ‌های شما تهیه شده است؛ جای معاینه، تشخیص یا برنامهٔ درمانی فردی را نمی‌گیرد.',
    based_on: [...lifestyle.based_on], precautions: [...lifestyle.precautions], follow_up: ['پایان هفته، موارد قابل‌انجام، علائم و موانع را یادداشت و در مراجعه مطرح کنید؛ بهبود تضمین‌شده نیست.'],
    seek_care: ['با تورم ناگهانی زبان یا صورت، مشکل تنفس، کاهش هوشیاری یا درد شدید قفسهٔ سینه با ۱۱۵ تماس بگیرید و منتظر برنامهٔ آنلاین نمانید.'], data_limits: ['مقدار غذا، نیاز انرژی، معاینه و همهٔ محدودیت‌های فرد از این پرسشنامه مشخص نمی‌شود.'], source_ids: pack.topics.map(topic => topic.id) };
  if (allergies) common.precautions.push('حساسیت‌های پرونده و پاسخ شما: ' + allergies + '؛ مواد تشکیل‌دهنده و احتمال آلودگی متقاطع را بررسی کنید.');
  if (answers.medical_restrictions) common.based_on.push('محدودیت گزارش‌شدهٔ شما در انتخاب‌ها لحاظ شده است؛ جزئیات باید با درمانگر تأیید شود.');
  if (kind === 'nutrition') {
    const preference = { balanced: 'غذای متنوع', vegetarian: 'گیاه‌خواری با توجه به محدودیت‌های شما', vegan: 'گیاه‌خواری کامل', pescatarian: 'الگوی گیاهی همراه ماهیِ مجاز', other: 'الگوی غذایی انتخابی شما' }[answers.dietary_pattern];
    common.based_on.push('ترجیح شما: ' + preference + '؛ ' + (answers.cooking_time === 'quick' ? 'غذاهای ساده و کم‌زمان' : 'غذاهای خانگی قابل آماده‌سازی') + (answers.budget === 'economy' ? ' با خرید اقتصادی و مواد فصل.' : '.'));
    const personalAllergy = all => all.filter(food => allowedFood(food, allergies + '،' + answers.medical_restrictions, answers.dislikes));
    const vegan = answers.dietary_pattern === 'vegan', veg = vegan || answers.dietary_pattern === 'vegetarian', fish = answers.dietary_pattern === 'pescatarian';
    const breakfasts = personalAllergy([...(vegan ? [] : ['نان و پنیر ساده همراه سبزیِ مجاز', 'تخم‌مرغ با نان و سبزیِ مجاز']), 'عدسی ساده با نان مجاز', 'غذای گیاهی خانگی آشنا، همراه میوهٔ مجاز']);
    const lunches = personalAllergy(['خوراک حبوبات و سبزیِ مجاز همراه نان یا برنج', ...(veg || fish ? [] : ['مرغ خانگی کمتر سرخ‌شده با برنج و سبزیِ مجاز']), ...(fish ? ['ماهیِ مجاز با برنج و سبزیِ مجاز'] : []), 'عدس‌پلو با سبزیِ مجاز']);
    const dinners = personalAllergy(['سوپ سبزی و حبوباتِ مجاز همراه نان', 'خوراک سبزی و حبوباتِ مجاز', ...(vegan ? [] : ['املت ساده همراه نانِ مجاز'])]);
    const snacks = personalAllergy(['میوهٔ فصلِ مجاز', ...(vegan ? [] : ['ماست سادهٔ مجاز'])]);
    const restrictedMenu = context.vulnerable;
    const meal = (options, index) => options[index % options.length] || 'یکی از غذاهای آشنای مجاز و سازگار با حساسیت‌های خود';
    return { ...common, weight_goal: restrictedMenu ? 'در این شرایط وزن دلخواه به هدف کاهش/افزایش وزن تبدیل نمی‌شود؛ مقدار و هدف مناسب باید با درمانگر تعیین شود.' : 'هدف انتخابی شما (' + { maintain: 'حفظ وزن', gradual_loss: 'تغییر تدریجی رو به کاهش', gradual_gain: 'تغییر تدریجی رو به افزایش' }[answers.goal] + ') ترجیح شماست، نه نسخه یا وعدهٔ نتیجه؛ فعلاً بر وعده‌های منظم و عادت‌های پایدار تمرکز کنید.',
      weekly_menu: [0,1,2].map(index => ({ day: 'روز ' + ['اول','دوم','سوم'][index],
        breakfast: restrictedMenu ? 'صبحانهٔ مجازِ برنامهٔ درمانگر را حفظ کنید و آنچه می‌خورید ثبت کنید؛ مقدار و مواد تازه تعیین نمی‌شود.' : meal(breakfasts,index),
        lunch: restrictedMenu ? 'ناهار آشنای سازگار با برنامهٔ اختصاصی و حساسیت‌ها؛ پرسش دربارهٔ سهم و جایگزین مناسب را یادداشت کنید.' : meal(lunches,index),
        dinner: restrictedMenu ? 'شام معمولِ مجاز را بدون حذف وعده یا تغییر خودسرانهٔ مقدار ادامه دهید.' : meal(dinners,index),
        snacks: restrictedMenu ? 'میان‌وعده فقط مطابق الگوی مناسب سن/شرایط و برنامهٔ درمانگر؛ پیشنهاد عمومی جایگزین آن نیست.' : meal(snacks,index) })),
      shopping_list: restrictedMenu ? ['فقط مواد آشنای مجازِ فهرست درمانگر و سازگار با حساسیت‌ها را تهیه کنید.', 'برای تنظیم فهرست اختصاصی، برچسب غذا و برنامهٔ فعلی را به متخصص تغذیه نشان دهید.'] : personalAllergy(['نانِ مجاز و سازگار با محدودیت‌ها', 'برنج برای غذای خانگی', 'عدس یا حبوباتِ مجاز', 'سبزی‌های فصلِ مجاز', 'میوه‌های فصلِ مجاز', ...(vegan?[]:['تخم‌مرغِ مجاز','ماست سادهٔ مجاز']), ...(veg||fish?[]:['مرغ برای غذای خانگی']), ...(fish?['ماهیِ مجاز']:[])]).slice(0,8),
      habits: [answers.cooking_time === 'quick' ? 'یک غذای سادهٔ مجاز را برای بیش از یک وعده آماده کنید و طبق اصول نگهداری ایمن نگه دارید.' : 'برای سه روز مواد اولیهٔ مجاز را از قبل فهرست کنید تا تصمیم روزانه آسان‌تر شود.', ...lifestyle.first_week[0].steps.slice(0,1), 'این سه روز الگوی آموزشی و قابل جایگزینی است؛ مقدار غذا و نیاز انرژی نسخه‌نویسی نشده است.'] };
  }
  if (context.urgent) { common.precautions.unshift('وجود علامت هشدار را مطرح کرده‌اید؛ ابتدا ارزیابی پزشکی لازم است و افزودن محصول یا درمان تازه مناسب نیست.'); common.seek_care.unshift('اگر علامت شدید یا سریع رو به گسترش است، همین حالا ارزیابی شوید؛ در مشکل تنفس یا تورم زبان/لب با ۱۱۵ تماس بگیرید.'); }
  const limited = context.urgent || context.risk.child || context.risk.ageUnknown;
  common.data_limits = ['نوع پوست، علت ریزش مو یا بیماری پوستی از پرسشنامه تشخیص داده نمی‌شود؛ معاینه یا بررسی پزشک ممکن است لازم باشد.'];
  if (answers.duration) common.based_on.push('مدت مشکل طبق پاسخ شما ثبت شده است؛ ماندگاری یا بدترشدن آن را با متخصص پوست بررسی کنید.');
  if (answers.skin_sensitivity === 'yes') common.precautions.push('حساسیت پوست را گزارش کرده‌اید؛ محصولات کم‌تعداد، ملایم و بدون عطرِ سازگار با حساسیت‌های شناخته‌شده را ترجیح دهید.');
  common.seek_care.push('ریزش ناگهانی یا لکه‌ای، درد یا زخم پوست سر، ضایعهٔ خون‌ریزی‌دهنده یا تغییر سریع پوست نیاز به بررسی پزشک دارد.');
  return { ...common,
    morning_steps: limited ? ['مراقبت فعلیِ تأییدشده و مناسب سن را حفظ کنید؛ پیش از افزودن محصول، علامت و شرایط را با پزشک بررسی کنید.', 'برای محافظت از آفتاب از سایه و پوشش مناسب استفاده کنید؛ انتخاب محصول برای کودک یا پوست بیمار نیاز به نظر درمانگر دارد.'] : ['با شویندهٔ ملایمِ سازگار با پوست و آب ولرم، بدون سایش زیاد پاک‌سازی کنید.', 'مرطوب‌کنندهٔ سادهٔ مناسب و در صورت حضور در آفتاب محافظت با سایه، پوشش و محصول ضدآفتابِ مناسب طبق برچسب را در نظر بگیرید.'],
    evening_steps: limited ? ['روتین سادهٔ فعلی را حفظ کنید و علائم یا واکنش‌ها را برای مراجعه یادداشت کنید.'] : ['آلودگی و آرایش را با پاک‌کنندهٔ ملایمِ سازگار پاک کنید؛ از مالش شدید پرهیز کنید.', 'اگر پوست خشک یا حساس است، مرطوب‌کنندهٔ ساده و سازگار را طبق برچسب به کار ببرید؛ محصولات تازه را هم‌زمان اضافه نکنید.'],
    weekly_steps: ['یک تغییر کوچک در هر نوبت، همراه ثبت خارش، سوزش یا خشکی؛ در واکنش نامطلوب ادامه ندهید.', 'فهرست محصولات فعلی و نام حساسیت‌ها را برای بررسی متخصص آماده کنید؛ برند گران شرط اثربخشی نیست.'],
    hair_steps: ['با مو و پوست سر ملایم رفتار کنید؛ کشیدن مو، بستن خیلی سفت و حرارت یا مواد شیمیایی خشن را کمتر کنید.', 'برای ریزش مو علت را با پزشک بررسی کنید؛ مکمل رشد مو یا داروی تازه را از این روتین شروع نکنید.'],
    avoid: ['محصول محرک، اسکراب خشن، ترکیب چند محصول تازه و فرآوردهٔ دارای مادهٔ حساسیت‌زای شناخته‌شده مناسب نیست.', 'این برنامه دارو، رتینوئید، استروئید، درمان ریزش مو، لایه‌برداری قوی یا مقدار مصرف تجویز نمی‌کند.'],
    patch_test: limited ? 'فعلاً محصول تازه را بدون هماهنگی با درمانگر امتحان نکنید. آزمون خانگی جای تشخیص حساسیت نیست.' : 'محصول تازه را طبق برچسب روی قسمت کوچکی از پوست سالم امتحان کنید و هفت تا ده روز واکنش را ببینید؛ با قرمزی، خارش یا تورم مصرف را ادامه ندهید. این کار جای تست حساسیت پزشکی نیست.' };
}

const strings = { type: 'array', items: { type: 'string' } }, commonProperties = { title:{type:'string'},summary:{type:'string'},based_on:strings,precautions:strings,follow_up:strings,seek_care:strings,data_limits:strings,source_ids:strings };
export function wellnessSchema(kind) {
  const properties = kind === 'nutrition' ? { ...commonProperties, weekly_menu:{type:'array',items:{type:'object',additionalProperties:false,properties:Object.fromEntries(['day','breakfast','lunch','dinner','snacks'].map(key=>[key,{type:'string'}])),required:['day','breakfast','lunch','dinner','snacks']}},shopping_list:strings,habits:strings } : { ...commonProperties,...Object.fromEntries(['morning_steps','evening_steps','weekly_steps','hair_steps','avoid'].map(key=>[key,strings])),patch_test:{type:'string'} };
  return { type:'object',additionalProperties:false,properties,required:Object.keys(properties) };
}
function validOutputText(value,min=5) { return validGroundedText(value,1200,min) && !/[\d۰-۹٠-٩]+\s*(?:کالری|کیلوکالری|کیلوگرم|کیلو(?:\s|$)|kcal\b)/i.test(value); }
export function parseWellnessProgram(completion, kind, pack) {
  const choice=completion?.choices?.[0]; if(choice?.finish_reason!=='stop'||choice.message?.refusal)throw Error('WELLNESS_INCOMPLETE');
  const raw=JSON.parse(choice.message?.content||'{}'),schema=wellnessSchema(kind),output={};
  for(const [key,definition]of Object.entries(schema.properties)) {
    if(key==='source_ids'){if(!Array.isArray(raw[key])||raw[key].length<1||raw[key].length>6)throw Error('WELLNESS_INVALID_SOURCES');resolveMedicalSources(raw[key],pack);output[key]=[...new Set(raw[key])];continue;}
    if(key==='weekly_menu'){if(!Array.isArray(raw[key])||raw[key].length!==3||raw[key].some(row=>!row||['day','breakfast','lunch','dinner','snacks'].some(field=>!validOutputText(row[field],2))))throw Error('WELLNESS_INVALID_MENU');output[key]=raw[key].map(row=>Object.fromEntries(['day','breakfast','lunch','dinner','snacks'].map(field=>[field,row[field].trim()])));continue;}
    if(definition.type==='string'){if(!validOutputText(raw[key]))throw Error('WELLNESS_INVALID_TEXT_'+key.toUpperCase());output[key]=raw[key].trim();continue;}
    if(!Array.isArray(raw[key])||raw[key].length>40||((key!=='data_limits')&&!raw[key].length)||raw[key].some(item=>!validOutputText(item,key==='shopping_list'?2:5)))throw Error('WELLNESS_INVALID_LIST_'+key.toUpperCase());output[key]=raw[key].slice(0,key==='shopping_list'?12:8).map(item=>item.trim());
  }
  return output;
}
export function wellnessMessages(kind, record, answers, pack) {
  return [{role:'system',content:medicalEvidencePrompt(pack)+`\nراهنمای آموزشی ${kind==='nutrition'?'تغذیه':'پوست و مو'} هستی، پزشک فرد نیستی. فارسی ساده؛ تاریخ فقط شمسی. مثال عملی، حساسیت، سلیقه، بودجه و محدودیت پزشکی را رعایت کند. کالری، وزن هدف، دارو، مکمل، گیاه، رتینوئید، استروئید و تغییر درمان نده. وزن دلخواه ترجیح است نه هدف تأییدشده. زیر۲۰سال، سن نامعلوم، بارداری/احتمال آن، کلیه/قلب، کم‌وزنی یا اختلال خوردن، منوی اختصاصی و کاهش وزن نگیرند؛ برنامه درمانگر مقدم است. وعده حذف نشود؛ ناشتایی/رژیم افراطی نده. در کلیه آب/پروتئین/پتاسیم/فسفر تغییر نده. هشدار فوری مقدم بر روتین است.
${kind==='nutrition'?'weekly_menu دقیقاً سه روز، هرکدام day/breakfast/lunch/dinner/snacks کوتاه. shopping_list حداکثر دوازده قلم مواد اولیهٔ همان غذاها، با نام فارسی ساده و بدون مقدار مصرف. habits سه قدم عملی؛ وزن هدف یا عدد وزن ننویس؛ توضیح هدف را سرور از انتخاب فرد تنظیم می‌کند.':'morning_steps/evening_steps مراقبت ملایم کم‌مرحله، بدون مادهٔ حساسیت‌زا؛ weekly_steps پایش واکنش؛ hair_steps مراقبت ملایم و علت‌یابی ریزش. avoid محرک‌ها؛ patch_test آزمون محدود طبق برچسب، جای تست پزشکی نیست. کودک محصول تازه نگیرد.'}`},{role:'user',content:JSON.stringify({clinical_record:wellnessClinicalRecord(record),questionnaire:answers})}];
}
const MAX_OUTPUT_TOKENS=3000;
export function wellnessRequestEstimate(kind,record,answers,pack=wellnessEvidence(kind,record,answers)) {let weighted=0;for(const character of JSON.stringify(wellnessMessages(kind,record,answers,pack))+JSON.stringify(wellnessSchema(kind)))weighted+=character.codePointAt(0)<128?1:2;return Math.ceil(weighted/2)+MAX_OUTPUT_TOKENS+256;}
function guardProgram(kind,record,answers,program,pack) {
  const context=contextFor(record,answers);
  const allAllergies=[...record.allergies.map(row=>row.allergen),answers.additional_allergies,answers.medical_restrictions].filter(Boolean).join('، ');
  const foodSteps=kind==='nutrition'?[...program.weekly_menu.flatMap(day=>['breakfast','lunch','dinner','snacks'].map(key=>day[key])),...program.shopping_list,...program.habits]:[];
  const incompatibleFood=foodSteps.some(text=>!allowedFood(text,allAllergies,answers.dislikes)||!matchesDiet(text,answers.dietary_pattern));
  const unapprovedAdvice=foodSteps.some(text=>/(?:حذف\s*(?:کنید|شود|کن)|ناشتا\s*بمانید|روزه\s*بگیرید|رژیم\s*(?:سخت|افراطی)|فستینگ)/.test(text)||(/دارو|مکمل|دمنوش|گیاه\s*درمانی|دارویی/.test(text)&&/(?:^|\s)(?:کنید|کن|بخورید|بزنید|بگیرید)(?:[\s.!،]|$)/.test(text)));
  const unsafeSkin=kind==='skin_hair'&&[...program.morning_steps,...program.evening_steps,...program.weekly_steps,...program.hair_steps,program.patch_test].some(text=>/ماینوکسیدیل|فیناستراید|رتینو|رتینول|ترتینو|استروئید|کورتون|هیدروکینون|minoxidil|finasteride|retino|tretinoin|steroid|hydroquinone|اسید.{0,12}(?:سالیسیلیک|گلیکولیک)/i.test(text)||!allowedFood(text,allAllergies,''));
  const protectedFallback=incompatibleFood||unapprovedAdvice||unsafeSkin||(kind==='nutrition'&&context.vulnerable)||(kind==='skin_hair'&&(context.urgent||context.risk.child||context.risk.ageUnknown));
  if(protectedFallback)return {program:localWellnessProgram(kind,record,answers,pack),protectedFallback:true};
  const local=localWellnessProgram(kind,record,answers,pack);
  return {program:{...program,...(kind==='nutrition'?{weight_goal:local.weight_goal}:{}),precautions:[...new Set([...local.precautions,...program.precautions])].slice(0,8)},protectedFallback:false};
}
export async function generateWellnessProgram(client,kind,record,answers,userId,pack=wellnessEvidence(kind,record,answers)) {
  const completion=await client.chat.completions.create({model:HEALTH_NAVIGATOR_MODEL,messages:wellnessMessages(kind,record,answers,pack),max_completion_tokens:MAX_OUTPUT_TOKENS,response_format:{type:'json_schema',json_schema:{name:'drman_wellness_'+kind,strict:true,schema:wellnessSchema(kind)}},safety_identifier:crypto.createHash('sha256').update('wellness:'+userId).digest('hex').slice(0,32)},{timeout:45000});
  const {program,protectedFallback}=guardProgram(kind,record,answers,parseWellnessProgram(completion,kind,pack),pack);
  return {program,model:protectedFallback?null:HEALTH_NAVIGATOR_MODEL,source:protectedFallback?'local':'ai'};
}
export async function wellnessCoach({database,userId,patientId,kind,method='GET',answers:input,sessionVersion=0,getClient,verifySession,getDailyLimit=async()=>3,now=()=>Date.now()}) {
  if(!WELLNESS_KINDS.includes(kind))return{status:400,body:{success:false,error:'نوع برنامه معتبر نیست.'}};
  const access=await overviewAccess(database,userId,patientId);if(!access)return{status:404,body:{success:false,error:'پرونده پیدا نشد.'}};
  let record=await readOverviewRecord(database,access.patient,now());
  const {data:stored,error:storedError}=await database.from('patient_wellness_programs').select('questionnaire,program,source,input_fingerprint,generated_at').eq('patient_id',patientId).eq('user_id',userId).eq('kind',kind).maybeSingle();
  if(storedError)throw storedError;
  let answers;
  if(method==='POST')answers=wellnessAnswers(kind,input);
  else if(stored?.questionnaire&&Object.keys(stored.questionnaire).length) {try{answers=wellnessAnswers(kind,stored.questionnaire);}catch{answers=null;}}
  const inaccessible=()=>({status:403,body:{success:false,error:'دسترسی پرونده یا نشست تغییر کرده است.'}});
  async function allowed(){if(!(await verifySession()))return null;return overviewAccess(database,userId,patientId);}
  const disclaimer='این برنامه آموزشی است و جای معاینه و برنامهٔ درمانی فردی را نمی‌گیرد.';
  async function empty(){const current=await allowed();if(!current)return inaccessible();return{status:200,body:{success:true,kind,questionnaire:answers||{},program:null,source:null,state:'not_started',generated_at:null,ai_consent:current.consent,disclaimer}};}
  if(!answers)return empty();
  // Hash the complete selected snapshot: risks outside the compact transport
  // window still invalidate older advice and are considered by local guards.
  const pack=wellnessEvidence(kind,record,answers),hash=fingerprint(kind,record,answers,pack);
  function response(program,source,state,generatedAt=null,extra={}) {return{status:200,body:{success:true,kind,questionnaire:answers,program,source,state,generated_at:generatedAt,ai_consent:access.consent,sources:resolveMedicalSources(program.source_ids,pack),search_performed:false,evidence_reviewed_at:pack.reviewed_at,disclaimer:'این برنامه آموزشی است و جای معاینه و برنامهٔ درمانی فردی را نمی‌گیرد.',...extra}};}
  async function local(state,{persisted=false,generatedAt=null}={}) {const current=await allowed();if(!current)return inaccessible();return response(localWellnessProgram(kind,record,answers,pack),'local',current.consent?state:'consent_not_granted',generatedAt,{persisted,ai_consent:current.consent});}
  if(!access.consent)return local('consent_not_granted');
  if(method==='GET') {
    const current=await allowed();if(!current)return inaccessible();if(!current.consent)return local('consent_not_granted');
    if(!stored?.program)return empty();
    if(stored.input_fingerprint!==hash)return local('record_changed');
    try{const parsed=parseWellnessProgram({choices:[{finish_reason:'stop',message:{content:JSON.stringify(stored.program)}}]},kind,pack),guarded=guardProgram(kind,record,answers,parsed,pack);if(guarded.protectedFallback&&stored.source==='ai')return local('clinical_review');return response(guarded.program,'cached','ready',stored.generated_at,{persisted:true,program_source:stored.source});}catch{return local('program_unavailable');}
  }
  const current=await allowed();if(!current)return inaccessible();if(!current.consent)return local('consent_not_granted');
  let client=null,limit=0;
  const context=contextFor(record,answers),protectedContext=kind==='nutrition'?context.vulnerable:(context.urgent||context.risk.child||context.risk.ageUnknown),tooLarge=wellnessRequestEstimate(kind,record,answers,pack)>7800;
  try{limit=Math.max(0,Math.min(3,Math.floor(Number(await getDailyLimit())||0)));if(limit&&!protectedContext&&!tooLarge)client=await getClient();}catch{}
  const token=crypto.randomUUID(),args={p_user_id:userId,p_patient_id:patientId,p_session_version:sessionVersion,p_kind:kind,p_fingerprint:hash,p_claim_token:token};
  const {data:claim,error:claimError}=await database.rpc('claim_patient_wellness_program',{...args,p_allow_ai:Boolean(client),p_daily_limit:limit});
  if(claimError)return local('temporarily_unavailable');
  if(claim?.state==='access_changed')return inaccessible();if(claim?.state==='consent_not_granted')return local('consent_not_granted');
  if(claim?.state==='pending')return local('pending');
  if(claim?.state==='ready') {
    const {data:fresh}=await database.from('patient_wellness_programs').select('program,source,generated_at,input_fingerprint').eq('patient_id',patientId).eq('user_id',userId).eq('kind',kind).maybeSingle();
    const permission=await allowed();if(!permission)return inaccessible();if(!permission.consent)return local('consent_not_granted');
    if(fresh?.program&&fresh.input_fingerprint===hash){try{const parsed=parseWellnessProgram({choices:[{finish_reason:'stop',message:{content:JSON.stringify(fresh.program)}}]},kind,pack),guarded=guardProgram(kind,record,answers,parsed,pack);if(guarded.protectedFallback&&fresh.source==='ai')return local('clinical_review');return response(guarded.program,'cached','ready',fresh.generated_at,{persisted:true,program_source:fresh.source});}catch{return local('program_unavailable');}}
    return local('pending');
  }
  if(!['claimed','claimed_local'].includes(claim?.state))return local('temporarily_unavailable');
  async function finish(program,source='local',model=null){return database.rpc('finish_patient_wellness_program',{...args,p_questionnaire:answers,p_program:program,p_source:source,p_model:model,p_version:WELLNESS_VERSION});}
  try {
    const permission=await allowed();if(!permission)return inaccessible();if(!permission.consent)return local('consent_not_granted');
    record=await readOverviewRecord(database,permission.patient,now());if(fingerprint(kind,record,answers,pack)!==hash){await finish(null);return local('record_changed');}
    let program=localWellnessProgram(kind,record,answers,pack),source='local',state=context.urgent?'red_flags_review':protectedContext?'clinical_review':tooLarge?'record_too_large':claim.reason||'provider_unavailable',model=null;
    if(claim.state==='claimed'&&client){try{const generated=await generateWellnessProgram(client,kind,record,answers,userId,pack);program=generated.program;model=generated.model;source=generated.source;state=source==='ai'?'ready':'clinical_review';}catch{state='provider_unavailable';}}
    const final=await allowed();if(!final)return inaccessible();if(!final.consent)return local('consent_not_granted');
    record=await readOverviewRecord(database,final.patient,now());if(fingerprint(kind,record,answers,pack)!==hash){await finish(null);return local('record_changed');}
    const {data:saved,error:saveError}=await finish(program,source,model);
    const afterSave=await allowed();if(!afterSave)return inaccessible();if(!afterSave.consent)return local('consent_not_granted');
    if(saveError||saved?.saved!==true)return local('not_saved');
    return response(program,source,state,saved.generated_at,{persisted:true});
  }catch{await finish(null).catch(()=>null);return local('temporarily_unavailable');}
}
