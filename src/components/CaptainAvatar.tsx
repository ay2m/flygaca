import { useTranslation } from 'react-i18next';
import styles from './CaptainAvatar.module.css';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
/** Generated expression variants (256px) that map to specific UI states. */
export type AvatarPose = 'default' | 'wave' | 'thinking' | 'hold' | 'smile';

const sizeClass: Record<AvatarSize, string> = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
  xl: styles.xl,
};

const poseSrc: Record<Exclude<AvatarPose, 'default'>, string> = {
  wave: '/img/captain-adel.jpg',
  thinking: '/img/captain-adel.jpg',
  hold: '/img/captain-adel.jpg',
  smile: '/img/captain-adel.jpg',
};

interface CaptainAvatarProps {
  /** Visual footprint: sm (chat reply), md (cards), lg/xl (hero/welcome). */
  size?: AvatarSize;
  /** Expression variant. `default` is the canonical neutral portrait. */
  pose?: AvatarPose;
  /** Adds the live "online" ring glow — for surfaces that present him as active. */
  glow?: boolean;
  /** Presents him as live: a subtle idle "breathing" motion + an online status dot. */
  live?: boolean;
  /**
   * Plays the animated idle loop (`avatar-live.webp`) instead of the still — the
   * real "alive" portrait. Only takes effect when `live` and motion is allowed;
   * reserve it for a single focal avatar (welcome / the most-recent reply) so a
   * long thread never runs many photoreal loops at once. Falls back to the still
   * under reduced-motion or if the loop fails to load.
   */
  animated?: boolean;
  /** Decorative use (label already supplied by adjacent text) hides it from AT. */
  decorative?: boolean;
  /** Custom image source override (e.g., custom pilot avatar). */
  src?: string;
  className?: string;
}

/**
 * Captain Adel's portrait — the one place his face is wired in, so every surface
 * (chat welcome, each reply, the home hero, account) draws from the same official art.
 * All poses map to the canonical realistic portrait (/img/captain-adel.jpg).
 * The brand ring is token-driven and the glow honours reduced-motion via CSS.
 */
export function CaptainAvatar({
  size = 'md',
  pose = 'default',
  glow = false,
  live = false,
  animated: _animated = false,
  decorative = false,
  src: customSrc,
  className,
}: CaptainAvatarProps) {
  const { t } = useTranslation();

  const stillSrc = customSrc || (pose !== 'default' ? poseSrc[pose] : '/img/captain-adel.jpg');

  // Disable the cartoon animated idle loop for the new realistic portrait
  const playLoop = false;
  const src = stillSrc;
  const alt = decorative ? '' : t('chat.avatarAlt');

  const img = (
    <img
      src={src}
      alt={alt}
      aria-hidden={decorative || undefined}
      width={256}
      height={256}
      loading="lazy"
      decoding="async"
      draggable={false}
      // CSS breathing only when live but *not* playing the loop — the WebP carries
      // its own motion, so layering the keyframe on top would double it up.
      className={`${styles.avatar} ${sizeClass[size]} ${glow ? styles.glow : ''} ${
        live && !playLoop ? styles.alive : ''
      } ${live ? '' : (className ?? '')}`}
    />
  );

  // When live, wrap so we can anchor an "online" status dot in the corner; the
  // wrapper carries the caller's layout className so existing margins still apply.
  if (live) {
    return (
      <span className={`${styles.liveWrap} ${sizeClass[size]} ${className ?? ''}`}>
        {img}
        <span className={styles.statusDot} aria-hidden="true" />
      </span>
    );
  }

  return img;
}
