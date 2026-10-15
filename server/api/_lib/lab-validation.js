function numericText(value){return String(value??'').trim().replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g,'.').replace(/٬/g,',');}
function firstNumber(value){
  let s=numericText(value);
  if(/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s))s=s.replace(/,/g,'');
  if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s))return null;
  const number=Number(s);return Number.isFinite(number)?number:null;
}
function simpleRange(value){
  const s=numericText(value).replace(/[–—]/g,'-');
  const m=s.match(/^([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:-|تا|to)\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))$/i);
  if(!m)return null;const low=Number(m[1]),high=Number(m[2]);if(!Number.isFinite(low)||!Number.isFinite(high)||low>high)return null;return{low,high};
}
export function inferPrintedRangeFlag(value,referenceRange){
  const number=firstNumber(value);
  if(number==null)return null;
  const range=simpleRange(referenceRange);
  if(range)return number<range.low?'low':number>range.high?'high':'normal';
  // Only a whole, unqualified printed criterion is enough to classify a row.
  // Demographic tables, multiple intervals, censored values and contextual
  // labels stay unknown rather than selecting a convenient number from them.
  const bound=numericText(referenceRange).match(/^(<=|>=|<|>|≤|≥)\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+))$/u);
  if(!bound)return null;
  const limit=Number(bound[2]);
  if(!Number.isFinite(limit))return null;
  if(bound[1]==='<')return number<limit?'normal':'high';
  if(bound[1]==='<='||bound[1]==='≤')return number<=limit?'normal':'high';
  if(bound[1]==='>')return number>limit?'normal':'low';
  return number>=limit?'normal':'low';
}
export function validateLabResult(input){
  const result={...input,items:Array.isArray(input?.items)?input.items.map(x=>({...x})):[]};
  const corrections=[];
  for(const item of result.items){
    const value=firstNumber(item.value),range=simpleRange(item.reference_range);
    if(value==null||!range||item.flag==='critical')continue;
    const expected=value<range.low?'low':value>range.high?'high':'normal';
    if(['normal','low','high'].includes(item.flag)&&item.flag!==expected){corrections.push(`${item.name}: ${item.flag}→${expected}`);item.flag=expected;}
  }
  const quality=String(result.read_quality||'partial');
  let confidence=Math.max(0,Math.min(1,Number(result.confidence??0.5)));
  if(quality==='partial')confidence=Math.min(confidence,.78);
  if(quality==='poor')confidence=Math.min(confidence,.45);
  result.confidence=confidence;
  const hasCritical=result.items.some(x=>x.flag==='critical');
  if(result.status==='normal'&&result.items.some(x=>['low','high','critical'].includes(x.flag))){result.status='warning';result.status_reason='حداقل یک مورد خارج از محدوده یا علامت‌گذاری‌شده در برگه وجود دارد؛ نتیجه را با پزشک بررسی کنید.';}
  if(result.status==='danger'&&!hasCritical){result.status='warning';result.status_reason=`نیاز به پیگیری پزشکی؛ برچسب خطر قطعی پس از اعتبارسنجی تأیید نشد. ${String(result.status_reason||'')}`.trim();}
  if(quality==='poor'){result.status=result.status==='danger'?'danger':'warning';if(!result.next_steps?.some(x=>String(x).includes('واضح')))result.next_steps=['تصویر واضح‌تر یا فایل PDF آزمایش را دوباره ارسال کنید.',...(result.next_steps||[])];}
  if(corrections.length)result.validation_corrections=corrections.slice(0,30);
  return result;
}
