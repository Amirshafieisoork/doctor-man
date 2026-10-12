// Read-only entitlement resolution avoids overwriting a newer payment activation.
export function subscriptionExpired(user,now=Date.now()){
  if(!user?.plan_expires_at)return false;
  const expires=Date.parse(user.plan_expires_at);
  return !Number.isFinite(expires)||expires<=now;
}

export async function readEntitlement(database,userId,now=Date.now()){
  const {data:user,error}=await database.from('users')
    .select('id,name,phone,status,plan_id,plan_started_at,plan_expires_at,plans(id,name,slug,price,test_limit,family_profile_limit,navigator_daily_limit,support_daily_limit,features,is_popular,duration_days,active)')
    .eq('id',userId).maybeSingle();
  if(error)throw error;
  if(!user)throw new Error('USER_NOT_FOUND');
  if(user.status!=='active')throw new Error('USER_BLOCKED');
  const expired=subscriptionExpired(user,now);
  let plan=user.plans;
  const fallback=!plan||expired||plan.active!==true;
  if(fallback){
    const {data:freePlan,error:planError}=await database.from('plans')
      .select('id,name,slug,price,test_limit,family_profile_limit,navigator_daily_limit,support_daily_limit,features,is_popular,duration_days,active')
      .eq('slug','free').eq('active',true).maybeSingle();
    if(planError)throw planError;
    if(!freePlan)throw new Error('FREE_PLAN_UNAVAILABLE');
    plan=freePlan;
  }
  return {user,plan,expired,startsAt:fallback?null:user.plan_started_at,expiresAt:fallback?null:user.plan_expires_at};
}

export function planLimit(plan,key){
  if(plan?.[key]===undefined||plan[key]===null)throw new Error('INVALID_PLAN_LIMIT');
  const value=Number(plan?.[key]);
  if(!Number.isSafeInteger(value)||value<0)throw new Error('INVALID_PLAN_LIMIT');
  return value;
}
