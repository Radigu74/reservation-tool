export async function loadTenantReservationsSettings(supabase, businessId, columns = '*') {
  const { data, error } = await supabase
    .from('reservation_business_settings')
    .select(columns)
    .eq('business_id', Number(businessId))
    .maybeSingle()
  if (error) throw new Error(`Reservations configuration could not be loaded: ${error.message}`)
  if (!data) throw new Error('Reservations configuration is missing for this business.')
  return data
}

export async function loadPublicReservationsConfiguration(supabase, businessSlug) {
  const { data, error } = await supabase.rpc('get_public_reservations_configuration', {
    p_business_slug: businessSlug,
  })
  if (error) throw new Error(`Public Reservations configuration could not be loaded: ${error.message}`)
  const settings = Array.isArray(data) ? data[0] : data
  if (!settings) throw new Error('Public Reservations configuration is unavailable.')
  return settings
}
