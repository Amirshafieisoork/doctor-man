/* Question-driven educational programs, scoped to the selected health record. */
(() => {
  'use strict';
  const configs={
    nutrition:{mount:'nutritionCoachMount',page:'nutritionCoach',title:'برنامه غذایی هوشمند',intro:'غذای روزمره، سلیقه و شرایط شما مهم است. چند سؤال کوتاه را پاسخ دهید تا یک برنامهٔ قابل اجرا برای همین پرونده تهیه شود.',button:'ساخت برنامه غذایی من'},
    skin_hair:{mount:'skinHairCoachMount',page:'skinHairCoach',title:'روتین پوست و مو',intro:'نوع پوست، محصولات فعلی و وضعیت موهایتان را بگویید تا راهنمای مراقبت روزانهٔ متناسب با پاسخ‌های شما آماده شود.',button:'ساخت روتین پوست و موی من'}
  };
  const states=new Map();let generation=0,context=null,bmi=null;
  const REQUEST_TIMEOUT_MS=60000,LOAD_TIMEOUT_MS=20000;
  const pregnancyOptions='<option value="unknown">نمی‌دانم / هنوز بررسی نکرده‌ام</option><option value="no">خیر</option><option value="yes">باردار هستم</option><option value="possible">احتمال بارداری وجود دارد</option>';
  const pregnancyField='<label class="full wellness-pregnancy" data-pregnancy-field>آیا باردار هستید یا احتمال آن وجود دارد؟<select name="pregnancy_status">'+pregnancyOptions+'</select><small>برای انتخاب توصیه‌های ایمن از اطلاعات همین پرونده هم استفاده می‌شود.</small></label>';
  // NOTE: full fields and functions restored in next commit
  function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=String(text??'');if(className)element.className=className;return element;}
  function status(state,message,error=false){state.status.textContent=message;state.status.classList.toggle('wellness-error',error);}
  function renderProgram(state,data){
    state.output.replaceChildren();state.consent.hidden=data.state!=='consent_not_granted';
    const program=data.program;if(!program||typeof program!=='object')return;
    const article=node('article',undefined,'wellness-program'),heading=node('h2',program.title||configs[state.kind].title);heading.tabIndex=-1;
    article.append(heading,node('p',program.summary||'','wellness-summary'));
    if(state.kind==='nutrition'){
      const kcal=program.daily_calories??program.calories??null;
      if(kcal!=null||program.weight_goal){
        const hero=node('div',undefined,'wellness-hero');
        const calCard=node('div',undefined,'wellness-hero-card');
        calCard.append(node('span','هدف کالری روزانه','label'),node('span',kcal!=null?String(Math.round(Number(kcal)))+' کیلوکالری':'—','value'),node('span',program.weight_goal||'بر اساس شرایط شما','hint'));
        hero.append(calCard);
        article.append(hero);
      }
      if(Array.isArray(program.weekly_menu)&&program.weekly_menu.length){
        const section=node('section');section.append(node('h3','نمونهٔ وعده‌ها برای شروع'));
        const menu=node('div',undefined,'wellness-menu');
        for(const day of program.weekly_menu.slice(0,7)){
          if(!day||typeof day!=='object')continue;
          const card=node('section',undefined,'wellness-day');
          card.append(node('h4',day.day||'یک روز پیشنهادی'));
          for(const [key,label] of [['breakfast','صبحانه'],['lunch','ناهار'],['dinner','شام'],['snacks','میان‌وعده']]){
            if(typeof day[key]==='string'&&day[key]){
              const meal=node('div',undefined,'wellness-meal');
              meal.append(node('span',label,'meal-label'),node('p',day[key],'meal-text'));
              card.append(meal);
            }
          }
          menu.append(card);
        }
        section.append(menu);article.append(section);
      }
    }
    article.append(node('p',data.disclaimer||'این برنامه راهنمای آموزشی است.','wellness-small'));state.output.append(article);
  }
  // Minimal mount for now
  function mountCoach(kind){
    const cfg=configs[kind];const mount=document.getElementById(cfg.mount);if(!mount)return;
    const heading=node('h2',cfg.title);const intro=node('p',cfg.intro,'wellness-intro');
    const contextBox=node('div',undefined,'wellness-context');
    const form=document.createElement('form');form.className='wellness-questionnaire';form.innerHTML='<p>در حال بازگردانی کامل فرم...</p>';
    const statusBox=node('p',undefined,'wellness-status');
    const consent=node('div',undefined,'wellness-consent');consent.hidden=true;
    const output=node('div',undefined,'wellness-output');
    mount.replaceChildren(heading,intro,contextBox,form,statusBox,consent,output);
    const state={kind,mount,context:contextBox,form,status:statusBox,consent,output,busy:false,loaded:false,dirty:false,patientId:'',generation:0,ticket:0,controller:null};states.set(kind,state);
    status(state,'در حال بارگذاری...');
  }
  for(const kind of Object.keys(configs))mountCoach(kind);
  document.addEventListener('drman:health-record-loaded',()=>{for(const state of states.values())status(state,'پرونده بارگذاری شد. نسخه کامل به زودی.');});
  import('/assets/bmi.js').then(module=>{bmi=module;}).catch(()=>{});
})();
