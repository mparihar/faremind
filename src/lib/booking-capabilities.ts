export function canAddBaggage(booking: any): boolean {
  return booking?.providerCapabilities?.addBaggageAllowed === true;
}
