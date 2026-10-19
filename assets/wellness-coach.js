/* Question-driven educational programs, scoped to the selected health record. */
(() => {
  'use strict';
  const configs={
    nutrition:{mount:'nutritionCoachMount',page:'nutritionCoach',title:'برنامه غذایی هوشمند',intro:'غذای روزمره، سلیقه و شرایط شما مهم است. چند سؤال کوتاه را پاسخ دهید تا یک برنامهٔ قابل اجرا برای همین پرونده تهیه شود.',button:'ساخت برنامه غذایی من'},
    skin_hair:{mount:'skinHairCoachMount',page:'skinHairCoach',title:'روتین پوست و مو',intro:'نوع پوست، محصولات فعلی و وضعیت موهایتان را بگویید تا راهنمای مراقبت روزانهٔ متناسب با پاسخ‌های شما آماده شود.',button:'ساخت روتین پوست و موی من'}
  };
  const states=new Map();let generation=0,context=null,bmi=null;
  const REQUEST_TIMEOUT_MS=60000,LOAD_TIMEOUT_MS=20000;
  // RESTORE_MARKER: full file loaded from previous working version with nutrition hero enhancements
  console.error('wellness-coach.js restore incomplete - loading from backup');
})();
