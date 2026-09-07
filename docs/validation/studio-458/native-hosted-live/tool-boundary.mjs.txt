export const allowedToolActions = new Set(['assets','packs','pack','source-preview','search','asset','validate-proposal']);
export function restrictToolFetch(forward,observe=()=>{}) {
 return async (url,init)=>{
  const parsed=new URL(String(url));
  if(parsed.pathname==='/api/studio/tools') {
   const {action}=JSON.parse(String(init?.body));
   const allowed=allowedToolActions.has(action);observe({action,allowed});
   if(!allowed)return Response.json({error:'This evaluation allows source reads and proposals only'},{status:403});
  }
  return forward(url,init);
 };
}
