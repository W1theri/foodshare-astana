export const STORAGE_KEY = 'foodshare-demo-v1';
export const money = n => '₸' + Number(n).toLocaleString('en-US');
export function nextDate() { const d = new Date(); d.setDate(d.getDate()+1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function seedState() {
 const common = {date:nextDate(), start:'18:00', end:'21:00', lat:51.1282, lng:71.4304};
 return {version:1, orders:[], offers:[
  {...common,id:'bakery',cafe:'Qala Bakery',title:'The baker’s surprise bag',category:'Bakery',price:1200,original:3600,stock:5,kg:0.7,distance:0.8,image:'assets/bread.jpg',address:'Demo location near Nurzhol Boulevard',allergens:'Wheat, milk, eggs. May contain nuts.',description:'A generous mix of bread and baked treats from the day. The exact selection is a surprise.'},
  {...common,id:'green',cafe:'Green Table',title:'Something fresh for dinner',category:'Meals',price:1600,original:4000,stock:4,kg:0.6,distance:1.2,image:'assets/salad.jpg',address:'Demo location near Dostyq Street',allergens:'Sesame, soy. Ask the café about the exact ingredients.',description:'A fresh seasonal meal with vegetables and grains. Contents vary with the day’s surplus.'},
  {...common,id:'croissant',cafe:'Little Crumb',title:'An afternoon pastry box',category:'Bakery',price:900,original:2700,stock:3,kg:0.4,distance:1.9,image:'assets/pastry.jpg',address:'Demo location near Qabanbay Batyr Avenue',allergens:'Wheat, butter, eggs. May contain nuts.',description:'A small box of pastries for a slow afternoon. An assorted selection chosen by the café.'},
  {...common,id:'garden',cafe:'The Corner Market',title:'The seasonal vegetable bag',category:'Produce',price:700,original:2100,stock:6,kg:1.2,distance:2.4,image:'assets/produce.jpg',address:'Demo location near Mangilik El Avenue',allergens:'Produce selection varies. Cross-contact is possible.',description:'Good vegetables with a little character. A changing selection ready for your next home-cooked meal.'}
 ]};
}
export function astanaDate(offset = 0) {
 return new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit',
 }).format(Date.now() + offset * 86400000);
}
export function pickupTime(offer, edge = 'start') {
 return new Date(`${offer.date}T${offer[edge]}:00${offer.utcOffset ?? ''}`).getTime();
}
export function expires(offer) { return pickupTime(offer, 'end'); }
export function validateOffer(o, now=Date.now()) {
 for (const field of ['cafe','title','address','allergens','description']) if (!o[field]?.trim() || o[field].length>600) throw Error('Please complete every text field with fewer than 600 characters.');
 if(!['Bakery','Meals','Produce'].includes(o.category)) throw Error('Choose a food category.');
 if (!Number.isInteger(o.price)||o.price<1||o.price>1000000) throw Error('Enter a whole-number price between ₸1 and ₸1,000,000.');
 if (!Number.isInteger(o.original)||o.original<=o.price||o.original>1000000) throw Error('The original price must be greater than the rescue price.');
 if (!Number.isInteger(o.stock)||o.stock<1||o.stock>100) throw Error('Quantity must be a whole number from 1 to 100.');
 if (!Number.isFinite(o.kg)||o.kg<=0||o.kg>50) throw Error('Estimated weight must be between 0 and 50 kg.');
 const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
 const date = new Date(o.date + 'T00:00:00Z');
 if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== o.date
  || !time.test(o.start) || !time.test(o.end) || o.end <= o.start || !Number.isFinite(expires(o)) || expires(o) <= now) {
  throw Error('Choose a future pickup date and an end time after the start time.');
 }
 return o;
}
export function addOffer(state, offer, now=Date.now()) { validateOffer(offer,now); if(state.offers.some(o=>o.id===offer.id)) throw Error('Offer already exists.'); return {...state,offers:[offer,...state.offers]}; }
export function reserve(state, id, qty, token, now=Date.now()) {
 const o=state.offers.find(o=>o.id===id);
 if(!o||o.paused||expires(o)<=now) throw Error('This offer is no longer available.');
 if(!Number.isInteger(qty)||qty<1||qty>o.stock) throw Error('Choose a quantity within the remaining stock.');
 if(state.orders.some(x=>x.token===token)) throw Error('Please try again with a new pickup code.');
 const order={id:token,token,offerId:id,cafe:o.cafe,title:o.title,image:o.image,address:o.address,date:o.date,start:o.start,end:o.end,utcOffset:o.utcOffset,allergens:o.allergens,qty,total:o.price*qty,originalTotal:o.original*qty,kg:o.kg*qty,status:'reserved',createdAt:now};
 return {...state,offers:state.offers.map(x=>x.id===id?{...x,stock:x.stock-qty}:x),orders:[order,...state.orders]};
}
export function cancel(state,id,now=Date.now()) {
 const o=state.orders.find(x=>x.id===id);
 if(!o||o.status!=='reserved') throw Error('Only an active reservation can be cancelled.');
 const source=state.offers.find(x=>x.id===o.offerId);
 if (!source||expires(o)<=now||expires(source)<=now) throw Error('The pickup window has ended. This reservation can no longer be cancelled.');
 return {...state,offers:state.offers.map(x=>x.id===o.offerId?{...x,stock:x.stock+o.qty}:x),orders:state.orders.map(x=>x.id===id?{...x,status:'cancelled'}:x)};
}
export function updateAvailability(state, id, stock, paused, now = Date.now()) {
 const offer = state.offers.find(o => o.id === id);
 if (!offer || expires(offer) <= now) throw Error('This offer has ended.');
 if (!Number.isInteger(stock) || stock < 0 || stock > 100 || typeof paused !== 'boolean') {
  throw Error('Enter a whole number from 0 to 100 for the available stock.');
 }
 const held = state.orders
  .filter(o => o.offerId === id && o.status === 'reserved' && expires(o) > now)
  .reduce((count, order) => count + order.qty, 0);
 if (stock + held > 100) throw Error(`At most ${100 - held} bags can be available while reservations are active.`);
 return { ...state, offers: state.offers.map(o => o.id === id ? { ...o, stock, paused } : o) };
}
export function collect(state,token,now=Date.now()) {
 const o=state.orders.find(x=>x.token===token.trim().toUpperCase());
 if(!o) throw Error('Pickup code not found. Check the code and try again.');
 if(o.status!=='reserved') throw Error('This pickup is already collected or cancelled.');
 if(expires(o)<=now) throw Error('The pickup window has ended.');
 // Early collection is allowed in this classroom demonstration.
 return {...state,orders:state.orders.map(x=>x.id===o.id?{...x,status:'collected',collectedAt:now}:x)};
}
export function impact(state) {
 return state.orders.filter(o=>o.status==='collected').reduce((a,o)=>({bags:a.bags+o.qty,kg:a.kg+o.kg,revenue:a.revenue+o.total,savings:a.savings+o.originalTotal-o.total}),{bags:0,kg:0,revenue:0,savings:0});
}
