'use strict';
const {HttpError}=require('../http.js');
function requireOwner(auth,user,config){
 auth.require(user,'admin');
 if(!config.adminEmail || user.email.toLowerCase()!==config.adminEmail.toLowerCase()) throw new HttpError(403,'This is B.Adams’ private padel board.');
}
module.exports=function(r,{db,auth,config}){
 r.get('/api/padel/entries',({user})=>{
  requireOwner(auth,user,config);
  return db.prepare('SELECT id,kind,data FROM padel_entries WHERE owner_id=?').all(user.id).map(x=>({...x,data:JSON.parse(x.data)}));
 });
 r.post('/api/padel/entries',({user,body:x})=>{
  requireOwner(auth,user,config);
  if(!['session','skills','intentions'].includes(x.kind)||typeof x.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(x.id)||!x.data||typeof x.data!=='object'||Array.isArray(x.data)||JSON.stringify(x.data).length>15000)throw new HttpError(400,'Invalid entry.');
  const d=x.data;
  if(x.kind==='session'){
   if(typeof d.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||isNaN(Date.parse(d.date))||new Date(d.date).toISOString().slice(0,10)!==d.date||!Number.isFinite(d.minutes)||d.minutes<1||d.minutes>600||!Number.isInteger(d.games)||d.games<0||!Number.isFinite(d.rpe)||d.rpe<0||d.rpe>10||!Number.isFinite(d.drill)||d.drill<0||d.drill>d.minutes||!['Play','Drilling','Play + drilling','Tournament','Lesson'].includes(d.type)||typeof d.baseline!=='boolean'||typeof d.focus!=='string'||typeof d.note!=='string')throw new HttpError(400,'Check the session date, time, games and effort.');
  } else if(x.kind==='skills') {
   if(Object.values(d).some(v=>!['','1','2','3','4','5'].includes(v)))throw new HttpError(400,'Skills must be rated from 1 to 5.');
  } else if (typeof d.weekly!=='string'||typeof d.target!=='string'||typeof d.intention!=='string'||(d.weekly!==''&&(!Number.isInteger(Number(d.weekly))||Number(d.weekly)<0||Number(d.weekly)>14)))throw new HttpError(400,'Check your training targets.');
  db.prepare('INSERT INTO padel_entries(owner_id,id,kind,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET kind=excluded.kind,data=excluded.data,updated_at=excluded.updated_at').run(user.id,x.id,x.kind,JSON.stringify(d),new Date().toISOString());
  return {ok:true};
 });
};
module.exports.requireOwner=requireOwner;
