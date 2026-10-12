import { InputValidationError, dateField, numberField } from './validate.js';

export function minutes(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(String(value))) throw new InputValidationError('ساعت معتبر نیست');
  const [h,m] = String(value).split(':').map(Number);
  return h * 60 + m;
}
export function validateSchedule(body) {
  const weekday = numberField(body.weekday,{label:'روز هفته',min:0,max:6,integer:true,nullable:false});
  const start = minutes(body.start_time), end = minutes(body.end_time);
  const slot = numberField(body.slot_minutes ?? 30,{label:'مدت نوبت',min:10,max:180,integer:true,nullable:false});
  if (end <= start || end - start < slot) throw new InputValidationError('بازه زمانی باید حداقل یک نوبت کامل داشته باشد');
  if (!['in_person','video','phone'].includes(body.mode ?? 'in_person')) throw new InputValidationError('نوع ویزیت معتبر نیست');
  if (body.active !== undefined && typeof body.active !== 'boolean') throw new InputValidationError('وضعیت برنامه معتبر نیست');
  return {weekday,start_time:String(body.start_time).slice(0,5),end_time:String(body.end_time).slice(0,5),slot_minutes:slot,mode:body.mode??'in_person',active:body.active??true};
}
export function localDate(date,timeZone='Asia/Tehran') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function zonedDate(dateStr,timeStr,timeZone) {
  dateField(dateStr); minutes(timeStr);
  const [y,m,d]=dateStr.split('-').map(Number),[hh,mm]=timeStr.slice(0,5).split(':').map(Number);
  const target=Date.UTC(y,m-1,d,hh,mm,0);
  let ts=target;
  for(let i=0;i<3;i++){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ts)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
    const seen=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
    if(seen===target)return new Date(ts);
    ts-=seen-target;
  }
  throw new InputValidationError('این ساعت در منطقه زمانی پزشک وجود ندارد');
}
