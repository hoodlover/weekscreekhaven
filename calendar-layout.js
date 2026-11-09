// Pure presentation geometry. Never change stored dates or occupied-night ranges.
const dayIndex = value => Date.parse(`${value}T00:00:00Z`) / 86400000;
export function calendarWeeks(events, firstDate, weekCount = 6) {
  const first = dayIndex(firstDate);
  return Array.from({length:weekCount}, (_, week) => {
    const start = (first + week * 7) * 2, end = start + 14;
    const segments = events.filter(event => !event.hiddenFromCalendar).map((event, order) => {
      const fullDays = event.type === 'blocked';
      const from = dayIndex(event.arrival) * 2 + (fullDays ? 0 : 1);
      const to = dayIndex(event.departure) * 2 + (fullDays ? 2 : 1);
      return {event, order, from, to, left:Math.max(from,start)-start, right:Math.min(to,end)-start,
        starts:from>=start, ends:to<=end};
    }).filter(segment => Number.isFinite(segment.from) && segment.to>segment.from && segment.left<segment.right)
      .sort((a,b)=>a.from-b.from || b.to-a.to || a.order-b.order);
    const lanes=[];
    for (const segment of segments) {
      let lane=lanes.findIndex(right=>right<=segment.left);
      if(lane<0) lane=lanes.length;
      lanes[lane]=segment.right; segment.lane=lane;
    }
    return {segments,laneCount:lanes.length};
  });
}
export function turnoverDates(events) {
  const stays=events.filter(event=>!event.hiddenFromCalendar && ['booked','reserved','external'].includes(event.type) && event.status!=='offered');
  const arrivals=new Set(stays.map(event=>event.arrival));
  return new Set(stays.filter(event=>arrivals.has(event.departure)).map(event=>event.departure));
}
