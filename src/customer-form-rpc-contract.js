export const CUSTOMER_FORM_RPC_CONTRACTS = Object.freeze({
  create_public_booking: Object.freeze({
    name: 'p_customer_name',
    email: 'p_customer_email',
    phone: 'p_customer_phone',
    customData: 'p_custom_data',
  }),
  create_public_session_booking: Object.freeze({
    name: 'p_customer_name',
    email: 'p_customer_email',
    phone: 'p_customer_phone',
    customData: 'p_custom_data',
  }),
  create_public_restaurant_reservation: Object.freeze({
    name: 'p_customer_name',
    email: null,
    phone: 'p_phone',
    customData: 'p_custom_data',
    emailInCustomData: 'customer_email',
  }),
  create_public_class_enquiry: Object.freeze({
    name: 'p_guardian_name',
    email: 'p_customer_email',
    phone: 'p_customer_phone',
    customData: 'p_custom_data',
  }),
})

export function augmentCustomerFormRpcArgs(functionName, args = {}, identity = {}, customData = {}) {
  const contract = CUSTOMER_FORM_RPC_CONTRACTS[functionName]
  if (!contract) return args
  const next = { ...args }
  const mergedCustomData = { ...(args[contract.customData] || {}), ...customData }
  if (identity.name !== undefined) next[contract.name] = identity.name
  if (identity.email !== undefined && contract.email) next[contract.email] = identity.email
  if (identity.email && contract.emailInCustomData) mergedCustomData[contract.emailInCustomData] = identity.email
  if (identity.phone !== undefined) next[contract.phone] = identity.phone
  next[contract.customData] = mergedCustomData
  return next
}
