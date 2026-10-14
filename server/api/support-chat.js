import ticketsHandler from './support-tickets.js';

// Keep the existing chat route while storing every conversation as a ticket.
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({success:false,error:'Method not allowed'});
  req.body={...(req.body||{}),title:req.body?.title||'گفتگو با پشتیبانی',category:req.body?.category||'other'};
  return ticketsHandler(req,res);
}
