import { supabase } from './supabaseclient.js'
import { resolveReservationsConfiguration } from './reservation-configuration.js'
import { formValues, normalizeCustomerForm, serializeCustomerFormAnswers, validateCustomerForm, renderCustomerFormField } from './customer-form-contract.js'
import { buildCustomerJourney, filterRestaurantSlotsForPartySize, isCustomerVisibleService, resolveJourneyConfiguration, restaurantPartySizeRange, scheduledRegistrationPresentation } from './reservation-journey.js'
import { loadPublicReservationsConfiguration } from './reservation-settings-access.js'
import {
  PUBLIC_ASSIGNMENT_PROJECTION,
  PUBLIC_SERVICE_PROJECTION,
  PUBLIC_STAFF_PROJECTION,
  publicRows,
} from './public-booking-data.js'

const route = location.pathname.split('/').filter(Boolean)

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))
const cash = (value, currency) => value == null ? '' : new Intl.NumberFormat(undefined,{style:'currency',currency:currency||'MYR'}).format(Number(value))
const priceLabel = (service, value = service.price) => {
  const formatted = cash(value, service.currency)
  if (!formatted) return ''
  return Number(service.price_session_count || 1) > 1 ? formatted+' for '+service.price_session_count+' sessions' : formatted
}
const businessTypeLabel = business => {
  return business?.reservationConfiguration?.terminology?.serviceSingular || 'Service'
}
const app = () => document.querySelector('#app')
const customFieldName = field => `custom_${field.id}`
const customFieldOptions = field => String(field.field_options || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
const customFieldMarkup = field => renderCustomerFormField(field, customFieldName(field))
const customFieldAnswers = (form, fields) => serializeCustomerFormAnswers(fields, formValues(form, normalizeCustomerForm(fields)))
const reportPublicQueryError = (area, error) => console.error(`Public booking ${area} query failed.`, { code: error?.code || 'unknown' })

async function start() {
  document.body.classList.add('public-booking-page')
  app().innerHTML = '<main class="booking-shell">Loading booking page…</main>'
  const businessSlug=route[1], si=route.findIndex(x=>x.toLowerCase()==='services'), ti=route.findIndex(x=>x.toLowerCase()==='team')
  const serviceSlug=si<0?null:route[si+1], staffSlug=ti<0?null:route[ti+1]
  const {data:businessRows,error:businessError}=await supabase.rpc('get_public_booking_business',{p_business_slug:businessSlug})
  if(businessError){reportPublicQueryError('business',businessError);return fail('Booking page could not be loaded.')}
  const business=businessRows?.[0]
  if(!business) return fail('Booking page not found.')
  let settings
  try { settings = await loadPublicReservationsConfiguration(supabase, businessSlug) }
  catch { return fail('Booking configuration could not be loaded.') }
  business.reservationConfiguration = resolveJourneyConfiguration({
    templateKey: settings?.template_key,
    businessType: business.business_type,
    terminology: settings?.terminology,
    capabilities: settings?.capabilities,
  })
  if (!serviceSlug && business.reservationConfiguration.capabilities.services === false) return capabilityDrivenEntry(business)
  document.title='Book with '+business.business_name
  if(!serviceSlug) return businessPage(business)
  const {data:service,error:serviceError}=await supabase.from('services').select(PUBLIC_SERVICE_PROJECTION).eq('business_id',business.id).ilike('slug',serviceSlug).eq('is_active',true).eq('is_published',true).eq('is_internal',false).maybeSingle()
  if(serviceError){reportPublicQueryError('service',serviceError);return fail('This service could not be loaded.')}
  if(!service) return fail('This service is not available.')
  if(service.booking_type==='restaurant') return restaurantServicePage(business,service)
  if(service.scheduling_mode==='scheduled') return scheduledServicePage(business,service)
  if(!staffSlug) return servicePage(business,service)
  const {data:staff,error:staffError}=await supabase.from('staff_members').select(PUBLIC_STAFF_PROJECTION).eq('business_id',business.id).ilike('slug',staffSlug).eq('is_active',true).eq('is_published',true).maybeSingle()
  if(staffError){reportPublicQueryError('team member',staffError);return fail('This team member could not be loaded.')}
  if(!staff) return fail('This team member is not available.')
  const {data:assignment,error:assignmentError}=await supabase.from('staff_services').select(PUBLIC_ASSIGNMENT_PROJECTION).eq('staff_id',staff.id).eq('service_id',service.id).eq('is_active',true).maybeSingle()
  if(assignmentError){reportPublicQueryError('team assignment',assignmentError);return fail('This team member could not be loaded.')}
  if(!assignment) return fail('This team member does not provide that service.')
  calendarPage(business,service,staff,assignment)
}

function shell(business,content,crumb=''){
  app().innerHTML='<main class="booking-shell"><header class="booking-header"><a class="booking-brand" href="/book/'+esc(business.business_slug)+'">'+esc(business.business_name)+'</a><span>Online booking</span></header>'+(crumb?'<nav class="booking-crumb">'+crumb+'</nav>':'')+content+bookingManagerMarkup()+'</main>'
  setupBookingManager(business)
}
async function businessPage(business){
  const [servicesResult,cohortsResult]=await Promise.all([supabase.from('services').select(PUBLIC_SERVICE_PROJECTION).eq('business_id',business.id).eq('is_active',true).eq('is_published',true).eq('is_internal',false).order('name'),supabase.rpc('get_public_cohort_availability',{p_business_slug:business.business_slug})])
  if(servicesResult.error){reportPublicQueryError('services',servicesResult.error);return fail('Services could not be loaded.')}
  if(cohortsResult.error){reportPublicQueryError('class availability',cohortsResult.error);return fail('Class availability could not be loaded.')}
  const services=publicRows(servicesResult.data),cohorts=publicRows(cohortsResult.data)
  const visibleServices=services.filter(isCustomerVisibleService)
  const cohortMap=Object.fromEntries(cohorts.map(item=>[item.service_id,item]))
  shell(business,'<section class="booking-hero"><p class="booking-kicker">Choose a service</p><h1>How can we help?</h1><p>Select a service to see the team and available times.</p></section><section class="booking-grid">'+(visibleServices.map(s=>{const cohort=cohortMap[s.id];return '<a class="booking-card" href="/book/'+esc(business.business_slug)+'/services/'+esc(s.slug)+'"><span class="booking-type">'+esc(businessTypeLabel(business))+'</span><h2>'+esc(s.name)+'</h2><p>'+esc(s.description||'')+'</p><div><span>'+(cohort?(cohort.is_full?'Class full':cohort.remaining+' place'+(cohort.remaining===1?'':'s')+' left'):s.duration_minutes+' min')+'</span><strong>'+priceLabel(s)+'</strong></div></a>'}).join('')||'<p>No services are published yet.</p>')+'</section>')
}
async function capabilityDrivenEntry(business) {
  if (business.reservationConfiguration.capabilities.guestCount) {
    return restaurantServicePage(business, { name: business.reservationConfiguration.terminology.bookingSingular })
  }
  return fail('Reservations are not configured for this business.')
}
async function servicePage(business,service){
  const {data,error}=await supabase.from('staff_services').select(`custom_duration_minutes,custom_price,staff_members!inner(${PUBLIC_STAFF_PROJECTION})`).eq('service_id',service.id).eq('is_active',true)
  if(error){reportPublicQueryError('team',error);return fail('Team members could not be loaded.')}
  const items=publicRows(data)
  const cards=items.map(item=>{const s=item.staff_members;return '<a class="booking-card staff-card" href="/book/'+esc(business.business_slug)+'/services/'+esc(service.slug)+'/team/'+esc(s.slug)+'"><div class="staff-avatar">'+(s.photo_url?'<img src="'+esc(s.photo_url)+'" alt="">':esc(s.display_name[0]))+'</div><div><h2>'+esc(s.display_name)+'</h2><p>'+esc(s.bio||'')+'</p><span>'+(item.custom_duration_minutes||service.duration_minutes)+' min · '+priceLabel(service,item.custom_price??service.price)+'</span></div></a>'}).join('')
  shell(business,'<section class="booking-hero compact"><p class="booking-kicker">'+esc(businessTypeLabel(business))+'</p><h1>'+esc(service.name)+'</h1><p>'+esc(service.description||'Choose a team member.')+'</p></section><h2>Choose your team member</h2><section class="booking-grid">'+(cards||'<p>No team members are available.</p>')+'</section>','<a href="/book/'+esc(business.business_slug)+'">Services</a><span>/</span><span>'+esc(service.name)+'</span>')
}
async function restaurantServicePage(business,service){
  const today=new Date(), max=new Date(); max.setDate(max.getDate()+60)
  const settingsResult=await supabase.from('restaurant_settings').select('max_guests_per_slot').eq('business_id',business.id).maybeSingle()
  if(settingsResult.error||!settingsResult.data){reportPublicQueryError('restaurant settings',settingsResult.error);return fail('Restaurant settings could not be loaded.')}
  const partyRange=restaurantPartySizeRange(settingsResult.data.max_guests_per_slot)
  const crumb=business.reservationConfiguration.capabilities.services===false?'':'<a href="/book/'+esc(business.business_slug)+'">Services</a><span>/</span><span>'+esc(service.name)+'</span>'
  shell(business,'<section class="booking-hero compact"><p class="booking-kicker">'+esc(business.reservationConfiguration.terminology.bookingSingular)+'</p><h1>Choose your party and time</h1><p>Choose your party size, date and available time.</p></section><section class="calendar-panel restaurant-party-size"><div><label for="partySize">Number of guests</label><input id="partySize" type="number" min="'+partyRange.min+'" max="'+partyRange.max+'" value="1" required><p>Up to '+partyRange.max+' guests per table.</p></div></section><section class="calendar-panel"><div><label for="bookingDate">Choose a date</label><input id="bookingDate" type="date" min="'+dateValue(today)+'" max="'+dateValue(max)+'" value="'+dateValue(today)+'"><p id="restaurantTimezone" class="timezone"></p></div><div><h2>Available times</h2><div id="availableSlots" class="slot-grid"></div></div></section><form id="publicBookingForm" class="booking-form" hidden><h2>Guest details</h2><p id="selectedTime"></p><div class="form-grid"><label>Name<input name="name" required maxlength="200"></label><label>Phone<input name="phone" required maxlength="50"></label></div><label>Special requests<textarea name="notes" maxlength="2000"></textarea></label><button class="booking-confirm" type="submit">Confirm reservation</button><p id="bookingMessage" role="status"></p></form>',crumb)
  const party=document.querySelector('#partySize'),date=document.querySelector('#bookingDate'),slots=document.querySelector('#availableSlots'),form=document.querySelector('#publicBookingForm'),timezone=document.querySelector('#restaurantTimezone')
  let selected=null
  async function load(){
    selected=null;form.hidden=true;slots.innerHTML='<p>Checking availability…</p>'
    const quantity=Number(party.value)
    if(!Number.isInteger(quantity)||quantity<partyRange.min||quantity>partyRange.max){slots.innerHTML='<p>Choose a valid number of guests.</p>';return}
    const {data,error}=await supabase.rpc('get_public_restaurant_slots',{p_business_slug:business.business_slug,p_local_date:date.value})
    if(error){reportPublicQueryError('restaurant availability',error);slots.innerHTML='<p>Availability could not be loaded.</p>';return}
    const rows=filterRestaurantSlotsForPartySize(publicRows(data),quantity)
    timezone.textContent=rows[0]?.timezone?'Times shown in '+rows[0].timezone:''
    slots.innerHTML=rows.length?rows.map(row=>'<button type="button" class="slot" data-time="'+esc(String(row.reservation_time).slice(0,8))+'" data-capacity="'+row.remaining_capacity+'">'+esc(String(row.reservation_time).slice(0,5))+'<small>'+row.remaining_capacity+' guest'+(row.remaining_capacity===1?'':'s')+' available</small></button>').join(''):'<p>No times available on this date.</p>'
    slots.querySelectorAll('.slot').forEach(button=>button.onclick=()=>{slots.querySelectorAll('.slot').forEach(item=>item.classList.remove('selected'));button.classList.add('selected');selected={time:button.dataset.time,capacity:Number(button.dataset.capacity)};form.hidden=false;document.querySelector('#selectedTime').textContent=quantity+' guest'+(quantity===1?'':'s')+' · '+date.value+' at '+button.dataset.time.slice(0,5)})
  }
  date.onchange=load
  party.onchange=load
  form.onsubmit=async event=>{
    event.preventDefault();if(!selected)return
    const values=new FormData(form),button=form.querySelector('[type="submit"]'),message=document.querySelector('#bookingMessage'),quantity=Number(party.value)
    if(!Number.isInteger(quantity)||quantity<partyRange.min||quantity>partyRange.max||quantity>selected.capacity){message.textContent='Choose a guest count within the available capacity.';return}
    button.disabled=true;message.textContent='Confirming…'
    const {data,error}=await supabase.rpc('create_public_restaurant_reservation',{p_business_slug:business.business_slug,p_customer_name:values.get('name'),p_phone:values.get('phone'),p_reservation_date:date.value,p_reservation_time:selected.time,p_party_size:quantity,p_special_request:values.get('notes')||null,p_custom_data:{}})
    button.disabled=false
    if(error){message.textContent=error.message.includes('capacity')||error.message.includes('available')?'That time no longer has enough capacity. Please choose again.':'Reservation could not be completed.';return}
    form.innerHTML='<div class="booking-success"><p class="booking-kicker">Reservation confirmed</p><h2>Thank you, '+esc(values.get('name'))+'.</h2><p>Your table for '+quantity+' has been reserved.</p><p>Your reference is <strong>'+esc(data)+'</strong>.</p></div>'
  }
  load()
}
async function scheduledServicePage(business,service){
  if(service.enrollment_mode==='cohort') return cohortServicePage(business,service)
  const today=new Date(), max=new Date(); max.setDate(max.getDate()+60)
  const crumb='<a href="/book/'+esc(business.business_slug)+'">Services</a><span>/</span><span>'+esc(service.name)+'</span>'
  const presentation=scheduledRegistrationPresentation(business.reservationConfiguration,service)
  const packageInfo=presentation.packageSessions>1?'<p><strong>Package:</strong> '+esc(priceLabel(service))+' · '+presentation.packageSessions+' sessions'+(presentation.packageValidityDays?' · valid for '+presentation.packageValidityDays+' days':'')+'.</p>':''
  shell(business,'<section class="booking-hero compact"><p class="booking-kicker">Scheduled '+esc(businessTypeLabel(business))+'</p><h1>'+esc(service.name)+'</h1><p>'+esc(service.description||'Choose a published session.')+'</p>'+packageInfo+'</section><section class="calendar-panel scheduled-calendar"><div><label for="bookingDate">Choose a date</label><input id="bookingDate" type="date" min="'+dateValue(today)+'" max="'+dateValue(max)+'" value="'+dateValue(today)+'"><p class="timezone">Times are shown in each '+esc(business.reservationConfiguration.terminology.teamMemberSingular.toLowerCase())+'’s timezone.</p></div><div><h2>Available sessions</h2><div id="availableSessions" class="session-grid"></div></div></section><form id="publicBookingForm" class="booking-form" hidden><h2>'+esc(presentation.formHeading)+'</h2><p id="selectedTime"></p><div class="form-grid"><label>'+esc(business.reservationConfiguration.terminology.customerSingular)+' name<input name="name" required maxlength="200"></label><label>Email<input name="email" type="email" maxlength="320"></label><label>Phone<input name="phone" required maxlength="50"></label></div><label>Number of places<input name="quantity" type="number" min="1" value="1" required></label><label>Notes<textarea name="notes" maxlength="2000"></textarea></label><button class="booking-confirm" type="submit">'+esc(presentation.confirmLabel)+'</button><p id="bookingMessage" role="status"></p></form>',crumb)
  const date=document.querySelector('#bookingDate'), target=document.querySelector('#availableSessions'), form=document.querySelector('#publicBookingForm')
  let selected=null
  async function load(){
    selected=null;form.hidden=true;target.innerHTML='<p>Checking sessions…</p>'
    const {data,error}=await supabase.rpc('get_public_scheduled_sessions',{p_business_slug:business.business_slug,p_service_slug:service.slug,p_from_date:date.value,p_to_date:date.value})
    if(error){reportPublicQueryError('scheduled sessions',error);target.innerHTML='<p>Sessions could not be loaded.</p>';return}
    const rows=publicRows(data)
    target.innerHTML=rows.length?rows.map(session=>'<button type="button" class="session-choice" data-id="'+session.session_id+'" data-start="'+session.starts_at+'" data-end="'+session.ends_at+'" data-timezone="'+esc(session.staff_timezone)+'" data-capacity="'+session.remaining_capacity+'"><strong>'+new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZone:session.staff_timezone}).format(new Date(session.starts_at))+'–'+new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZone:session.staff_timezone}).format(new Date(session.ends_at))+'</strong><span>'+esc(session.staff_name)+'</span><small>'+session.remaining_capacity+' place'+(session.remaining_capacity===1?'':'s')+' remaining</small></button>').join(''):'<p>No sessions are available on this date.</p>'
    target.querySelectorAll('.session-choice').forEach(button=>button.onclick=()=>{
      target.querySelectorAll('.session-choice').forEach(item=>item.classList.remove('selected'));button.classList.add('selected')
      selected={id:Number(button.dataset.id),capacity:Number(button.dataset.capacity),label:button.querySelector('strong').textContent+' with '+button.querySelector('span').textContent,timezone:button.dataset.timezone}
      const quantity=form.elements.quantity;quantity.max=String(selected.capacity);quantity.value='1'
      document.querySelector('#selectedTime').textContent=date.value+' · '+selected.label+' ('+selected.timezone+')';form.hidden=false
    })
  }
  date.onchange=load
  form.onsubmit=async event=>{
    event.preventDefault();if(!selected)return
    const values=new FormData(form),button=form.querySelector('[type="submit"]'),message=document.querySelector('#bookingMessage')
    button.disabled=true;message.textContent='Confirming…'
    const {data,error}=await supabase.rpc('create_public_session_booking',{p_business_slug:business.business_slug,p_service_slug:service.slug,p_session_id:selected.id,p_customer_name:values.get('name'),p_customer_email:values.get('email')||null,p_customer_phone:values.get('phone')||null,p_notes:values.get('notes')||null,p_quantity:Number(values.get('quantity'))})
    button.disabled=false
    if(error){message.textContent=error.message.includes('place')||error.message.includes('available')?'That session no longer has enough places. Please choose again.':'Booking could not be completed.';return}
    form.innerHTML='<div class="booking-success"><p class="booking-kicker">'+esc(presentation.confirmationKicker)+'</p><h2>Thank you, '+esc(values.get('name'))+'.</h2><p>Your '+esc(business.reservationConfiguration.terminology.bookingSingular.toLowerCase())+' for '+esc(selected.label)+' is confirmed.</p><p>Your reference is <strong>'+esc(data[0].reference)+'</strong>.</p></div>'
  }
  load()
}

async function cohortServicePage(business,service){
  const today=new Date(), max=new Date();max.setDate(max.getDate()+60)
  const crumb='<a href="/book/'+esc(business.business_slug)+'">Services</a><span>/</span><span>'+esc(service.name)+'</span>'
  const [availabilityResult,sessionsResult,customerFieldsResult]=await Promise.all([
    supabase.rpc('get_public_cohort_availability',{p_business_slug:business.business_slug}),
    supabase.rpc('get_public_scheduled_sessions',{p_business_slug:business.business_slug,p_service_slug:service.slug,p_from_date:dateValue(today),p_to_date:dateValue(max)}),
    supabase.rpc('get_public_booking_custom_fields',{p_business_slug:business.business_slug})
  ])
  if(availabilityResult.error){reportPublicQueryError('cohort availability',availabilityResult.error);return fail('Class availability could not be loaded.')}
  if(sessionsResult.error){reportPublicQueryError('class sessions',sessionsResult.error);return fail('Class sessions could not be loaded.')}
  if(customerFieldsResult.error){reportPublicQueryError('customer form',customerFieldsResult.error);return fail('Customer Form could not be loaded.')}
  const availability=publicRows(availabilityResult.data),sessions=publicRows(sessionsResult.data),customerFields=publicRows(customerFieldsResult.data)
  const customFields=normalizeCustomerForm(customerFields,{activeOnly:true}).filter(field=>!field.system_key&&String(field.field_label).trim().toLowerCase()!=='student name')
  const cohort=availability.find(item=>item.service_id===service.id), remaining=cohort?.remaining??0
  const sessionList=sessions.length?sessions.map(item=>'<article class="session-choice static"><strong>'+new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:item.staff_timezone}).format(new Date(item.starts_at))+'</strong><span>'+esc(item.staff_name)+'</span></article>').join(''):'<p>No upcoming classes are published yet.</p>'
  const enquiryForm=remaining>0?`<form id="cohortEnrollmentForm" class="booking-form">
    <h2>Send an enrolment enquiry</h2><p>A staff member will contact you after this request. Enrolment is final only after you have spoken with the centre.</p>
    <div class="form-grid"><label>Parent or guardian name<input name="guardianName" required maxlength="200"></label><label>Student name<input name="studentName" required maxlength="200"></label><label>Email<input name="email" type="email" maxlength="320"></label><label>Phone<input name="phone" required maxlength="50"></label><label>Student date of birth<input name="dateOfBirth" type="date"></label><label>School year or grade<input name="schoolGrade" maxlength="100"></label><label>Preferred joining date<input name="joinsOn" type="date" min="${dateValue(today)}" value="${dateValue(today)}" required></label>${customFields.map(customFieldMarkup).join('')}</div>
    <label>Learning needs or questions<textarea name="notes" maxlength="2000"></textarea></label><label class="check-label"><input name="consent" type="checkbox" required> I agree that the centre may contact me about this enquiry.</label><button class="booking-confirm" type="submit">Send enquiry</button><p id="cohortMessage" role="status"></p></form>`:'<section class="booking-form"><h2>This class is full</h2><p>Please contact the centre about a waiting list.</p></section>'
  shell(business,'<section class="booking-hero compact"><p class="booking-kicker">Continuing class</p><h1>'+esc(service.name)+'</h1><p>'+esc(service.description||'Send an enquiry for a place in this continuing class.')+'</p><p><strong>'+remaining+' of '+service.capacity+' enquiry places available</strong></p><p><strong>Package:</strong> '+priceLabel(service)+'. The class continues on every published timetable day; this price covers '+Number(service.price_session_count||1)+' sessions.</p></section><section class="calendar-panel scheduled-calendar"><div><h2>Upcoming classes</h2><p>The class runs on the centre’s published timetable. Individual classes may be postponed or cancelled by the centre.</p></div><div class="session-grid">'+sessionList+'</div></section>'+enquiryForm,crumb)
  const form=document.querySelector('#cohortEnrollmentForm');if(!form)return
  form.onsubmit=async event=>{
    event.preventDefault()
    const values=new FormData(form),button=form.querySelector('[type="submit"]'),message=document.querySelector('#cohortMessage'),answers=customFieldAnswers(form,customFields),validation=validateCustomerForm(customFields,Object.fromEntries(Object.entries(answers).filter(([key])=>key!=='_field_labels')))
    if(validation){message.textContent=validation;return}
    button.disabled=true;message.textContent='Sending enquiry…'
    const {data,error}=await supabase.rpc('create_public_class_enquiry',{p_business_slug:business.business_slug,p_service_slug:service.slug,p_guardian_name:values.get('guardianName'),p_student_name:values.get('studentName'),p_customer_email:values.get('email')||null,p_customer_phone:values.get('phone'),p_student_date_of_birth:values.get('dateOfBirth')||null,p_school_grade:values.get('schoolGrade')||null,p_joins_on:values.get('joinsOn'),p_notes:values.get('notes')||null,p_consent_to_contact:values.get('consent')==='on',p_custom_data:customFieldAnswers(form,customFields)})
    button.disabled=false
    if(error){message.textContent=error.message.includes('enough enquiry places')?'This class no longer has an enquiry place available. Please contact the centre.':error.message.includes('required customer form')?'Please complete all required Customer Form fields.':'Your enquiry could not be sent.';return}
    form.innerHTML='<div class="booking-success"><p class="booking-kicker">Enquiry received</p><h2>Thank you, '+esc(values.get('guardianName'))+'.</h2><p>A staff member will contact you. Final enrolment happens only after that conversation.</p><p>Your enquiry reference is <strong>'+esc(data[0].reference)+'</strong>. Save it together with the phone number you entered so you can check or withdraw this request below.</p></div>'
  }
}
function calendarPage(business,service,staff,assignment){
  const today=new Date(), max=new Date(); max.setDate(max.getDate()+60)
  const avatar=staff.photo_url?'<img src="'+esc(staff.photo_url)+'" alt="">':esc(staff.display_name[0])
  const crumb='<a href="/book/'+esc(business.business_slug)+'">Services</a><span>/</span><a href="/book/'+esc(business.business_slug)+'/services/'+esc(service.slug)+'">'+esc(service.name)+'</a><span>/</span><span>'+esc(staff.display_name)+'</span>'
  const provider = business.reservationConfiguration.capabilities.teamResources ? '<section class="booking-profile"><div class="staff-avatar large">'+avatar+'</div><div><p class="booking-kicker">'+esc(service.name)+'</p><h1>'+esc(staff.display_name)+'</h1><p>'+esc(staff.bio||'')+'</p><span>'+(assignment.custom_duration_minutes||service.duration_minutes)+' min · '+priceLabel(service,assignment.custom_price??service.price)+'</span></div></section>' : ''
  shell(business,provider+'<section class="calendar-panel"><div><label for="bookingDate">Choose a date</label><input id="bookingDate" type="date" min="'+dateValue(today)+'" max="'+dateValue(max)+'" value="'+dateValue(today)+'"><p class="timezone">Times shown in '+esc(staff.timezone)+'</p></div><div><h2>Available times</h2><div id="availableSlots" class="slot-grid"></div></div></section><form id="publicBookingForm" class="booking-form" hidden><h2>Your details</h2><p id="selectedTime"></p><div class="form-grid"><label>Name<input name="name" required maxlength="200"></label><label>Email<input name="email" type="email" maxlength="320"></label><label>Phone<input name="phone" required maxlength="50"></label></div><label>Notes<textarea name="notes" maxlength="2000"></textarea></label><button class="booking-confirm" type="submit">Confirm booking</button><p id="bookingMessage" role="status"></p></form>',crumb)
  const date=document.querySelector('#bookingDate'), slots=document.querySelector('#availableSlots'), form=document.querySelector('#publicBookingForm')
  let selected=null
  async function load(){
    selected=null;form.hidden=true;slots.innerHTML='<p>Checking availability…</p>'
    const {data,error}=await supabase.rpc('get_available_slots',{p_business_slug:business.business_slug,p_service_slug:service.slug,p_staff_slug:staff.slug,p_local_date:date.value})
    if(error){reportPublicQueryError('availability',error);slots.innerHTML='<p>Availability could not be loaded.</p>';return}
    const rows=publicRows(data)
    slots.innerHTML=rows.length?rows.map(x=>'<button type="button" class="slot" data-start="'+x.starts_at+'">'+new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZone:staff.timezone}).format(new Date(x.starts_at))+'</button>').join(''):'<p>No times available on this date.</p>'
    slots.querySelectorAll('.slot').forEach(button=>button.onclick=()=>{slots.querySelectorAll('.slot').forEach(x=>x.classList.remove('selected'));button.classList.add('selected');selected=button.dataset.start;form.hidden=false;document.querySelector('#selectedTime').textContent=date.value+' at '+button.textContent+' ('+staff.timezone+')'})
  }
  date.onchange=load
  form.onsubmit=async event=>{
    event.preventDefault();if(!selected)return
    const values=new FormData(form), button=form.querySelector('[type="submit"]'), message=document.querySelector('#bookingMessage')
    button.disabled=true;message.textContent='Confirming…'
    const {data,error}=await supabase.rpc('create_public_booking',{p_business_slug:business.business_slug,p_service_slug:service.slug,p_staff_slug:staff.slug,p_starts_at:selected,p_customer_name:values.get('name'),p_customer_email:values.get('email')||null,p_customer_phone:values.get('phone')||null,p_notes:values.get('notes')||null})
    button.disabled=false
    if(error){message.textContent=error.message.includes('no longer')?'That time was just taken. Please choose another.':'Booking could not be completed.';return}
    form.innerHTML='<div class="booking-success"><p class="booking-kicker">Booking confirmed</p><h2>Thank you, '+esc(values.get('name'))+'.</h2><p>Your reference is <strong>'+esc(data[0].reference)+'</strong>.</p><p>Please save this reference. Email confirmation can be enabled later.</p></div>'
  }
  load()
}

function bookingManagerMarkup(){
  return '<details class="booking-manager"><summary>Manage an existing booking</summary><form id="bookingManagerLookup" class="manager-lookup"><p>Enter the booking reference and the same phone number used when booking.</p><div class="form-grid"><label>Booking reference<input name="reference" required maxlength="80"></label><label>Phone<input name="phone" required maxlength="50"></label></div><button type="submit">Find booking</button><p class="manager-message" role="status"></p></form><div id="bookingManagerResult"></div></details>'
}

function setupBookingManager(business){
  const form=document.querySelector('#bookingManagerLookup')
  if(!form)return
  const result=document.querySelector('#bookingManagerResult'), message=form.querySelector('.manager-message')
  let credentials=null, booking=null
  form.onsubmit=async event=>{
    event.preventDefault();const values=new FormData(form)
    credentials={reference:String(values.get('reference')).trim(),phone:String(values.get('phone')).trim()}
    message.textContent='Looking up booking…';result.innerHTML=''
    const {data,error}=await supabase.rpc('get_public_booking_for_management',{p_business_slug:business.business_slug,p_reference:credentials.reference,p_phone:credentials.phone})
    booking=data?.[0]
    if(error||!booking){
      const {data:enquiries,error:enquiryError}=await supabase.rpc('get_public_class_enquiry',{p_business_slug:business.business_slug,p_reference:credentials.reference,p_phone:credentials.phone})
      const enquiry=enquiries?.[0]
      if(enquiryError||!enquiry){message.textContent='Booking or enquiry not found. Check the reference and phone number.';return}
      message.textContent=''
      result.innerHTML='<div class="manager-current"><p class="booking-kicker">Enrolment enquiry</p><h3>'+esc(enquiry.class_name)+'</h3><p>Student: '+esc(enquiry.student_name)+' · Preferred start: '+esc(enquiry.joins_on)+'</p><p>Status: '+esc(enquiry.enquiry_status)+(enquiry.contact_requested?' · Contact requested':'')+'</p><div class="manager-actions">'+(enquiry.enquiry_status!=='withdrawn'?'<button type="button" id="requestEnquiryContact">Ask staff to contact me</button><button type="button" class="danger" id="withdrawEnquiry">Withdraw enquiry</button>':'')+'</div><p class="manager-message" id="managerActionMessage" role="status"></p></div>'
      document.querySelector('#requestEnquiryContact')?.addEventListener('click',()=>manageEnquiry('request_contact'))
      document.querySelector('#withdrawEnquiry')?.addEventListener('click',()=>manageEnquiry('withdraw'))
      return
    }
    message.textContent=''
    renderManager()
  }
  async function manageEnquiry(action){
    if(action==='withdraw'&&!confirm('Withdraw this enrolment enquiry?'))return
    const status=document.querySelector('#managerActionMessage');status.textContent=action==='withdraw'?'Withdrawing…':'Sending request…'
    const {error}=await supabase.rpc('manage_public_class_enquiry',{p_business_slug:business.business_slug,p_reference:credentials.reference,p_phone:credentials.phone,p_action:action})
    status.textContent=error?'The enquiry could not be updated.':action==='withdraw'?'Your enquiry has been withdrawn.':'The centre has been asked to contact you.'
  }
  function renderManager(){
    const zone=booking.staff_timezone||'UTC'
    const when=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:zone}).format(new Date(booking.starts_at))
    const provider=booking.booking_kind==='restaurant'?'Restaurant reservation':booking.staff_name||'Assigned team member'
    result.innerHTML='<div class="manager-current"><p class="booking-kicker">Current booking</p><h3>'+esc(booking.service_name)+'</h3><p>'+esc(when)+' · '+esc(provider)+'</p><p>Status: '+esc(booking.status)+'</p><div class="manager-actions"><button type="button" id="showReschedule">Reschedule</button><button type="button" class="danger" id="cancelManagedBooking">Cancel booking</button></div><div id="managerOptions"></div><p class="manager-message" id="managerActionMessage" role="status"></p></div>'
    document.querySelector('#showReschedule').onclick=showOptions
    document.querySelector('#cancelManagedBooking').onclick=cancelBooking
  }
  async function showOptions(){
    const options=document.querySelector('#managerOptions'), today=new Date(), max=new Date();max.setDate(max.getDate()+31)
    options.innerHTML='<label>Choose a date<input id="managerDate" type="date" min="'+dateValue(today)+'" max="'+dateValue(max)+'" value="'+dateValue(today)+'"></label><div id="managerSlots" class="slot-grid"><p>Checking availability…</p></div>'
    const date=document.querySelector('#managerDate');date.onchange=loadOptions;loadOptions()
  }
  async function loadOptions(){
    const date=document.querySelector('#managerDate'), slots=document.querySelector('#managerSlots')
    slots.innerHTML='<p>Checking availability…</p>'
    if(booking.booking_kind==='restaurant'){
      const {data,error}=await supabase.rpc('get_public_restaurant_reschedule_slots',{p_business_slug:business.business_slug,p_reservation_reference:credentials.reference,p_phone:credentials.phone,p_local_date:date.value})
      if(error){slots.innerHTML='<p>Availability could not be loaded.</p>';return}
      slots.innerHTML=data?.length?data.map(item=>'<button type="button" class="slot manager-slot" data-restaurant-time="'+esc(String(item.reservation_time).slice(0,8))+'">'+esc(String(item.reservation_time).slice(0,5))+'</button>').join(''):'<p>No alternatives are available on this date.</p>'
      slots.querySelectorAll('.manager-slot').forEach(button=>button.onclick=()=>reschedule(button))
      return
    }
    const {data,error}=await supabase.rpc('get_public_booking_reschedule_options',{p_business_slug:business.business_slug,p_reference:credentials.reference,p_phone:credentials.phone,p_from_date:date.value,p_to_date:date.value})
    if(error){slots.innerHTML='<p>Availability could not be loaded.</p>';return}
    slots.innerHTML=data?.length?data.map(x=>{const zone=x.staff_timezone||booking.staff_timezone||'UTC';const label=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(x.starts_at));return '<button type="button" class="slot manager-slot" data-start="'+x.starts_at+'" data-session="'+(x.session_id||'')+'">'+esc(label)+'<small>'+esc(x.staff_name||'')+'</small></button>'}).join(''):'<p>No alternatives are available on this date.</p>'
    slots.querySelectorAll('.manager-slot').forEach(button=>button.onclick=()=>reschedule(button))
  }
  async function reschedule(button){
    const status=document.querySelector('#managerActionMessage');status.textContent='Rescheduling…'
    const params=button.dataset.restaurantTime
      ? ['reschedule_public_restaurant_reservation',{p_business_slug:business.business_slug,p_reservation_reference:credentials.reference,p_phone:credentials.phone,p_new_date:document.querySelector('#managerDate').value,p_new_time:button.dataset.restaurantTime}]
      : ['reschedule_public_booking',{p_business_slug:business.business_slug,p_reference:credentials.reference,p_phone:credentials.phone,p_new_starts_at:button.dataset.session?null:button.dataset.start,p_new_session_id:button.dataset.session?Number(button.dataset.session):null}]
    const {data,error}=await supabase.rpc(params[0],params[1])
    if(error||data===false){const detail=error?.message||'';status.textContent=detail.includes('available')||detail.includes('places')||detail.includes('capacity')?'That option was just taken. Please choose another.':'Booking could not be rescheduled.';return}
    status.textContent='Booking rescheduled successfully.';form.requestSubmit()
  }
  async function cancelBooking(){
    if(!confirm('Cancel this booking?'))return
    const status=document.querySelector('#managerActionMessage');status.textContent='Cancelling…'
    const params=booking.booking_kind==='restaurant'
      ? ['cancel_public_restaurant_reservation',{p_business_slug:business.business_slug,p_reservation_reference:credentials.reference,p_phone:credentials.phone}]
      : ['cancel_public_booking',{p_business_slug:business.business_slug,p_reference:credentials.reference,p_phone:credentials.phone}]
    const {data,error}=await supabase.rpc(params[0],params[1])
    if(error||!data){status.textContent='Booking could not be cancelled.';return}
    result.innerHTML='<div class="booking-success"><h3>Booking cancelled</h3><p>Your booking has been cancelled.</p></div>'
  }
}

function dateValue(date){const o=date.getTimezoneOffset();return new Date(date.getTime()-o*60000).toISOString().slice(0,10)}
function fail(message){app().innerHTML='<main class="booking-shell booking-error"><h1>'+esc(message)+'</h1><p>Check the link or contact the business.</p></main>'}

if (route[0]?.toLowerCase() === 'book' && route[1]) start()
