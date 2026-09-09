import { createClient } from '@supabase/supabase-js'
import { usesUniversalBookingStagingProject } from './supabase-environment.js'

const isUniversalBookingPreview = usesUniversalBookingStagingProject(window.location.hostname)
const stagingUrl = 'https://mmnojpzqmihlsoxjecpm.supabase.co'
const stagingPublishableKey = 'sb_publishable_TMuXrY_Kejd8QsVLlAvSTA_IOxu7hLV'

const supabaseUrl = isUniversalBookingPreview ? stagingUrl : import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = isUniversalBookingPreview ? stagingPublishableKey : import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
