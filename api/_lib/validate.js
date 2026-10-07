export class InputValidationError extends Error {
  constructor(message, code='INVALID_INPUT'){super(message);this.name='InputValidationError';this.code=code;this.status=400}
}
export function numberField(value,{label='مقدار',min=-Infinity,max=Infinity,integer=false,nullable=true}={}){
  if(value===undefined||value===null||value===''){if(nullable)return null;throw new InputValidationError(`${label} الزامی است`)}
  const n=typeof value==='number'?value:Number(String(value).trim());
  if(!Number.isFinite(n))throw new InputValidationError(`${label} باید عدد معتبر باشد`);
  if(integer&&!Number.isInteger(n))throw new InputValidationError(`${label} باید عدد صحیح باشد`);
  if(n<min||n>max)throw new InputValidationError(`${label} باید بین ${min.toLocaleString('fa-IR')} و ${max.toLocaleString('fa-IR')} باشد`);
  return n;
}
export function dateField(value,{label='تاریخ',allowFuture=true,minYear=1900}={}){
  if(value===undefined||value===null||value==='')return null;
  const raw=String(value).trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))throw new InputValidationError(`${label} معتبر نیست`);
  const d=new Date(raw+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==raw)throw new InputValidationError(`${label} معتبر نیست`);
  if(d.getUTCFullYear()<minYear)throw new InputValidationError(`${label} خارج از بازه قابل قبول است`);
  const now=new Date();now.setUTCHours(0,0,0,0);if(!allowFuture&&d>now)throw new InputValidationError(`${label} نمی‌تواند در آینده باشد`);
  return raw;
}
export function birthDateField(value,{label='تاریخ تولد',maxAge=125}={}){
  const raw=dateField(value,{label,allowFuture:false,minYear:1900});if(!raw)return null;
  const d=new Date(raw+'T00:00:00Z'),now=new Date();let age=now.getUTCFullYear()-d.getUTCFullYear();const m=now.getUTCMonth()-d.getUTCMonth();if(m<0||(m===0&&now.getUTCDate()<d.getUTCDate()))age--;if(age>maxAge)throw new InputValidationError(`${label} خارج از بازه قابل قبول است`);return raw;
}
