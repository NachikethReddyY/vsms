import communityCover from '../../assets/event-covers/community-screening.jpg';
import libraryCover from '../../assets/event-covers/library-screening.jpg';
import operationsCover from '../../assets/event-covers/event-operations.jpg';

export const EVENT_BANNERS = [
  {
    key: 'COMMUNITY_SCREENING',
    label: 'Community screening',
    description: 'A bright, welcoming community screening space.',
    src: communityCover,
  },
  {
    key: 'LIBRARY_SCREENING',
    label: 'Library screening',
    description: 'A calm public-library setting with warm architecture.',
    src: libraryCover,
  },
  {
    key: 'EVENT_OPERATIONS',
    label: 'Event operations',
    description: 'An abstract visual for planning and logistics.',
    src: operationsCover,
  },
] as const;

export type EventBannerKey = (typeof EVENT_BANNERS)[number]['key'];

export function getEventBanner(key?: string | null) {
  return EVENT_BANNERS.find((banner) => banner.key === key) ?? EVENT_BANNERS[0];
}
