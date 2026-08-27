export const LEGACY_REVIEWS = [
  {
    id: 'legacy-dez-2026-06', displayName: 'Dez', guestName: 'Dez', location: 'Knoxville, Tennessee', overall: 5,
    publicComments: 'This cabin is exactly what we needed. The loft, first-floor, and basement bedroom areas gave us all plenty of space to spread out. The kitchen is fully stocked with a huge open living area, and almost every room opens onto the amazing wraparound porch. It is private, quiet, and a wonderful retreat with everything you need.',
    allowTestimonial: true, recommend: true, imported: true, previousOwnership: true, source: 'Airbnb', createdAt: '2026-06-15T12:00:00.000Z',
  },
  {
    id: 'legacy-nick-2026-06', displayName: 'Nick', guestName: 'Nick', location: 'Clearwater, Florida', overall: 5,
    publicComments: 'We absolutely loved our stay! The home was clean, comfortable, and exactly as described. Great location and an excellent host. We would definitely stay here again and highly recommend it!',
    allowTestimonial: true, recommend: true, imported: true, previousOwnership: true, source: 'Airbnb', createdAt: '2026-06-14T12:00:00.000Z',
  },
  {
    id: 'legacy-angela-2026-07', displayName: 'Angela', guestName: 'Angela', location: 'Tucker, Georgia', overall: 5,
    publicComments: 'Beautiful and peaceful.',
    allowTestimonial: true, recommend: true, imported: true, previousOwnership: true, source: 'Airbnb', createdAt: '2026-07-15T12:00:00.000Z',
  },
  {
    id: 'legacy-natalia-2026-05', displayName: 'Natalia', guestName: 'Natalia', location: 'Johns Creek, Georgia', overall: 5,
    publicComments: 'The cabin is absolutely beautiful and very clean. It is super cozy and made me feel right at home. The kitchen is very well equipped, and I especially enjoyed spending time outside. The jacuzzi tub was amazing. I loved the privacy, and the beds were very comfortable. I highly recommend this place!',
    allowTestimonial: true, recommend: true, imported: true, previousOwnership: true, source: 'Airbnb', createdAt: '2026-05-15T12:00:00.000Z',
  },
  {
    id: 'legacy-ralph-2026-05', displayName: 'Ralph', guestName: 'Ralph', location: '', overall: 5,
    publicComments: 'Loved the place. Exactly what I needed.',
    allowTestimonial: true, recommend: true, imported: true, previousOwnership: true, source: 'Airbnb', createdAt: '2026-05-14T12:00:00.000Z',
  },
  {
    id: 'legacy-rebekah-2026-05', displayName: 'Rebekah', guestName: 'Rebekah', location: 'Mount Dora, Florida', overall: 5,
    publicComments: 'Wow! Truly, just wow! This cabin was even better than we imagined from the listing. Everything was clean and up to date. We loved relaxing on the porch by the fireplace and spending time unwinding in the jacuzzi. You will be close to so many great hikes, and there is plenty to see and do in nearby Blue Ridge. We would love to stay again, maybe in the fall!',
    allowTestimonial: true, recommend: true, imported: true, previousOwnership: true, source: 'Airbnb', createdAt: '2026-05-13T12:00:00.000Z',
  },
  {
    id: 'legacy-shane-2026-04', displayName: 'Shane', guestName: 'Shane', location: 'Houston, Texas', overall: 5,
    publicComments: 'Perfect cabin in the woods!',
    allowTestimonial: true, recommend: true, imported: true, previousOwnership: true, source: 'Airbnb', createdAt: '2026-04-15T12:00:00.000Z',
  },
  {
    id: 'legacy-chris-2026-04', displayName: 'Chris', guestName: 'Chris', location: 'Thomasville, Georgia', overall: 5,
    publicComments: 'Thank you for sharing your beautiful cabin with my family. We thoroughly enjoyed our stay! One of the cleanest places we have ever stayed, and it had absolutely everything we needed.',
    allowTestimonial: true, recommend: true, imported: true, previousOwnership: true, source: 'Airbnb', createdAt: '2026-04-14T12:00:00.000Z',
  },
  {
    id: 'legacy-esther-2026-02', displayName: 'Esther', guestName: 'Esther', location: 'Marietta, Georgia', overall: 5,
    publicComments: 'The cabin was beautiful! Every bedroom had a living room or sitting area and a full bathroom. I definitely recommend this cabin!',
    allowTestimonial: true, recommend: true, imported: true, previousOwnership: true, source: 'Airbnb', createdAt: '2026-02-15T12:00:00.000Z',
  },
  {
    id: 'legacy-luke-2026-02', displayName: 'Luke', guestName: 'Luke', location: '', overall: 5,
    publicComments: 'Beautiful cabin and great hosts. We will be back!',
    allowTestimonial: true, recommend: true, imported: true, previousOwnership: true, source: 'Airbnb', createdAt: '2026-02-14T12:00:00.000Z',
  },
];

export function combinedReviews(reviews = []) {
  return [...reviews, ...LEGACY_REVIEWS].sort((first, second) => String(second.createdAt).localeCompare(String(first.createdAt)));
}
