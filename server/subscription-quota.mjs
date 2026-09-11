const isWeekly=window=>window&&Number.isFinite(window.windowDurationMins)&&Math.abs(window.windowDurationMins-10080)<=1&&Number.isFinite(window.usedPercent);
export function weeklyQuota(snapshot,now=Date.now()){
  if(!snapshot)return {status:'unavailable',remainingPercent:null};
  const buckets=snapshot.buckets||[],codex=buckets.filter(bucket=>bucket.limitId==='codex');
  let bucket;
  if(codex.length===1)bucket=codex[0];
  else if((snapshot.primary||snapshot.secondary)&&(!snapshot.limitId||snapshot.limitId==='codex'))bucket=snapshot;
  else if(buckets.length===1&&(!buckets[0].limitId||buckets[0].limitId==='codex'))bucket=buckets[0];
  if(!bucket)return {status:'unavailable',remainingPercent:null};
  const windows=[bucket.primary,bucket.secondary].filter(isWeekly);
  if(windows.length!==1)return {status:'unavailable',remainingPercent:null};
  const window=windows[0],resetsAt=Number.isFinite(window.resetsAt)?window.resetsAt*1000:null;
  const checkedAt=Number.isFinite(snapshot.checkedAt)?snapshot.checkedAt:null;
  if(!checkedAt||now-checkedAt>90000||(resetsAt!==null&&resetsAt<=now))return {status:'stale',remainingPercent:null,checkedAt,resetsAt};
  return {status:'known',remainingPercent:Math.max(0,Math.min(100,100-window.usedPercent)),checkedAt,resetsAt,limitId:bucket.limitId||null};
}
