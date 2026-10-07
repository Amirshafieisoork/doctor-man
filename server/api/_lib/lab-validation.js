function firstNumber(value){
  const m=String(value??'').replace(/,/g,'').match(/[-+]?\d+(?:\.\d+)?/);return m?Number(m[0]):null;
}
function simpleRange(value){
  const s=String(value??'').replace(/,/g,'').replace(/[–—]/g,'-');
  const m=s.match(/([-+]?\d+(?:\.\d+)?)\s*(?:-|تا|to)\s*([-+]?\d+(?:\.\d+)?)/i);
  if(!m)return null;const low=Number(m[1]),high=Number(m[2]);if(!Number.isFinite(low)||!Number.isFinite(high)||low>high)return null;return{low,high};
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
  if(result.status==='danger'&&!hasCritical){result.status='warning';result.status_reason=`نیاز به پیگیری پزشکی؛ برچسب خطر قطعی پس از اعتبارسنجی تأیید نشد. ${String(result.status_reason||'')}`.trim();}
  if(quality==='poor'){result.status=result.status==='danger'?'danger':'warning';if(!result.next_steps?.some(x=>String(x).includes('واضح')))result.next_steps=['تصویر واضح‌تر یا فایل PDF آزمایش را دوباره ارسال کنید.',...(result.next_steps||[])];}
  if(corrections.length)result.validation_corrections=corrections.slice(0,30);
  return result;
}
