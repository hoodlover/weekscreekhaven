export function stayStage({ status = '', arrival = '', departure = '' }, today) {
  if (['completed', 'cancelled'].includes(status) || (departure && today > departure)) return 'after';
  if (arrival && departure && today >= arrival && today <= departure && status === 'booked') return 'during';
  return 'before';
}
