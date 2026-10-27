let csrf='';
const base=import.meta.env.BASE_URL.replace(/\/$/,'');
export function setCsrf(value){csrf=value||'';}
export async function api(path,options={}){
  const headers={...options.headers};
  if(options.body&&!(options.body instanceof FormData)){headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);}
  if(csrf)headers['X-CSRF-Token']=csrf;
  const response=await fetch(base+'/api'+path,{...options,headers,credentials:'same-origin',cache:'no-store'});
  if(!response.ok){let data;try{data=await response.json();}catch{}throw new Error(data?.error||`请求失败 (${response.status})`);}
  if(options.raw)return response;
  return response.json();
}
export async function uploadImage(file){const form=new FormData();form.append('image',file);return api('/media',{method:'POST',body:form});}
export const imageUrl=id=>id?base+'/api/media/'+encodeURIComponent(id):null;
export const resolveNoteMedia=content=>base?String(content||'').replaceAll('/api/media/',base+'/api/media/'):String(content||'');
export const cleanDate=v=>v?String(v).slice(0,10):'';
export const splitTags=v=>v.split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean).slice(0,20);
