import { supabase } from './supabaseclient.js'
import { resolveJourneyConfiguration } from './reservation-journey.js'
import { loadTenantReservationsSettings } from './reservation-settings-access.js'

const runtime = window.__TERRAPEAK_RESERVATIONS_RUNTIME__
if (!runtime || runtime.source !== 'terrapeak-dashboard') throw new Error('Trusted TerraPeak Reservations runtime is required.')
const businessId=Number(runtime.businessId), businessSlug=String(runtime.businessSlug||''), canManage=runtime.hasCapability?.('manageSettings')===true
const esc=(v='')=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')
const $=s=>document.querySelector(s)

async function load(){
  const [business,profile,branding,restaurant,restaurantService,general]=await Promise.all([
    supabase.from('businesses').select('*').eq('id',businessId).single(),
    supabase.from('business_profile').select('*').eq('business_id',businessId).maybeSingle(),
    supabase.from('restaurant_branding').select('*').eq('business_id',businessId).maybeSingle(),
    supabase.from('restaurant_settings').select('*').eq('business_id',businessId).maybeSingle(),
    supabase.from('services').select('*').eq('business_id',businessId).eq('booking_type','restaurant').eq('is_active',true).order('id').limit(1).maybeSingle(),
    loadTenantReservationsSettings(supabase,businessId)
  ])
  const failed=[business,profile,branding,restaurant,restaurantService].find(result=>result?.error)
  if(failed?.error||!business.data) throw failed?.error||new Error('Reservations business not found.')
  return {business:business.data,profile:profile.data||{},branding:branding.data||{},restaurant:restaurant.data||{},restaurantService:restaurantService.data||null,general}
}

async function render(){
  const c=await load(), p=c.profile, g=c.general, restaurant=c.restaurantService
  const capabilities=resolveJourneyConfiguration(g,c.business).capabilities
  const businessType=String(c.business.business_type||'general').toLowerCase()
  const isRestaurant=businessType==='restaurant'
  $('#app').innerHTML=`<main class="reservations-management"><h1>Settings</h1>${canManage?'':'<p class="read-only-notice">Settings are read-only for this TerraPeak role.</p>'}
  <section class="panel"><p class="eyebrow">Identity</p><h2>Business</h2><form id="businessForm"><label>Business name<input id="businessName" value="${esc(p.business_name||c.business.business_name)}" ${canManage?'':'disabled'}></label><label>Timezone<input id="timezone" value="${esc(g.timezone||c.restaurant.timezone||'Asia/Kuala_Lumpur')}" ${canManage?'':'disabled'}></label>${canManage?'<button>Save Business</button>':''}</form></section>
  <section class="panel"><p class="eyebrow">Customer page</p><h2>Branding</h2><form id="brandForm"><label>Display name<input id="displayName" value="${esc(c.branding.restaurant_name||p.business_name||c.business.business_name)}" ${canManage?'':'disabled'}></label><label>Primary color<input type="color" id="primaryColor" value="${esc(c.branding.primary_color||'#2f5d50')}" ${canManage?'':'disabled'}></label>${canManage?'<button>Save Branding</button>':''}</form></section>
  <section class="panel"><p class="eyebrow">Confirmation</p><h2>Booking Flow</h2><form id="flowForm"><label>When a customer submits<select id="bookingBehavior" ${canManage?'':'disabled'}><option value="immediate" ${g.booking_behavior!=='request'?'selected':''}>Confirm immediately</option><option value="request" ${g.booking_behavior==='request'?'selected':''}>Create a booking request</option></select></label><label>Confirmation message<textarea id="confirmationMessage" rows="3" ${canManage?'':'disabled'}>${esc(g.confirmation_message||'Your booking request has been received.')}</textarea></label>${canManage?'<button>Save Booking Flow</button>':''}</form></section>
  <section class="panel"><p class="eyebrow">Features</p><h2>Reservations capabilities</h2><form id="modulesForm"><label class="check-label"><input id="capServices" type="checkbox" ${capabilities.services?'checked':''} ${canManage?'':'disabled'}> Services <small>Let customers choose an offering.</small></label><label class="check-label"><input id="capTeam" type="checkbox" ${capabilities.teamResources?'checked':''} ${canManage?'':'disabled'}> Team & Resources</label><label class="check-label"><input id="capScheduled" type="checkbox" ${capabilities.scheduledSessions?'checked':''} ${canManage?'':'disabled'}> Scheduled sessions / classes</label><label class="check-label"><input id="capPackages" type="checkbox" ${capabilities.packages?'checked':''} ${canManage?'':'disabled'}> Packages</label><label class="check-label"><input id="capGuests" type="checkbox" ${capabilities.guestCount?'checked':''} ${canManage?'':'disabled'}> Guest / party count</label>${canManage?'<button>Save Capabilities</button>':''}</form></section>
  ${isRestaurant&&restaurant?`<section class="panel"><p class="eyebrow">Restaurant</p><h2>Restaurant booking settings</h2><form id="restaurantForm"><div class="form-row"><label>Opening time<input type="time" id="openingTime" value="${esc(String(c.restaurant.opening_time||'09:00').slice(0,5))}"></label><label>Closing time<input type="time" id="closingTime" value="${esc(String(c.restaurant.closing_time||'17:00').slice(0,5))}"></label></div><div class="form-row"><label>Maximum guests<input type="number" min="1" id="capacity" value="${Number(restaurant.capacity||1)}"></label><label>Duration<input type="number" min="1" id="duration" value="${Number(restaurant.duration_minutes||60)}"></label></div>${canManage?'<button>Save Restaurant Settings</button>':''}</form></section>`:''}<p id="settingsMessage" role="status"></p></main>`
  if(!canManage)return
  const msg=t=>{$('#settingsMessage').textContent=t}
  async function saveGeneral(payload){const {error}=await supabase.from('reservation_business_settings').upsert({business_id:businessId,...g,...payload},{onConflict:'business_id'});msg(error?error.message:'Settings saved.');if(!error)Object.assign(g,payload)}
  $('#businessForm').onsubmit=async e=>{e.preventDefault();const name=$('#businessName').value.trim();const r=await supabase.from('business_profile').upsert({business_id:businessId,...p,business_name:name},{onConflict:'business_id'});if(r.error)return msg(r.error.message);await saveGeneral({timezone:$('#timezone').value.trim()})}
  $('#brandForm').onsubmit=async e=>{e.preventDefault();const {error}=await supabase.from('restaurant_branding').upsert({business_id:businessId,...c.branding,restaurant_name:$('#displayName').value.trim(),primary_color:$('#primaryColor').value},{onConflict:'business_id'});msg(error?error.message:'Branding saved.')}
  $('#flowForm').onsubmit=e=>{e.preventDefault();saveGeneral({booking_behavior:$('#bookingBehavior').value,confirmation_message:$('#confirmationMessage').value.trim()})}
  $('#modulesForm').onsubmit=e=>{e.preventDefault();const next={services:$('#capServices').checked,teamResources:$('#capTeam').checked,scheduledSessions:$('#capScheduled').checked,packages:$('#capPackages').checked,guestCount:$('#capGuests').checked};if((next.scheduledSessions||next.packages)&&!next.services)return msg('Services must remain enabled for scheduled sessions or packages.');saveGeneral({capabilities:next,module_appointments:true,module_scheduled:next.scheduledSessions,module_packages:next.packages})}
  if(isRestaurant&&restaurant)$('#restaurantForm').onsubmit=async e=>{e.preventDefault();const capacity=Number($('#capacity').value),duration=Number($('#duration').value);const s=await supabase.from('services').update({capacity,duration_minutes:duration}).eq('id',restaurant.id).eq('business_id',businessId);if(s.error)return msg(s.error.message);const r=await supabase.from('restaurant_settings').upsert({business_id:businessId,...c.restaurant,opening_time:$('#openingTime').value,closing_time:$('#closingTime').value,max_guests_per_slot:capacity,default_duration_minutes:duration},{onConflict:'business_id'});msg(r.error?r.error.message:'Restaurant settings saved.')}
}
try { await render() } catch (error) {
  $('#app').innerHTML='<main class="reservations-management"><h1>Settings unavailable</h1><p role="alert"></p></main>'
  $('[role="alert"]').textContent=error.message
}
