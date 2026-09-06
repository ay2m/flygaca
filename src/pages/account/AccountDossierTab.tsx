import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  IdentificationBadge,
  Clock,
  UserCircle,
  ImageSquare,
  CheckCircle,
} from '@phosphor-icons/react';
import { TextField } from '@/components/calc/TextField';
import { SelectField, type SelectOption } from '@/components/calc/SelectField';
import { CaptainAvatar } from '@/components/CaptainAvatar';
import { saveProfile, USER_ROLES, type Profile } from '@/lib/services/account';
import { MAJOR_SAUDI_AIRPORTS, getAirportLabel } from './aviationMeta';
import { AvatarCustomizerModal } from './AvatarCustomizerModal';
import styles from './AccountPage.module.css';

const LICENCE_TYPES = ['SPL', 'PPL', 'CPL', 'ATPL'] as const;

interface AccountDossierTabProps {
  profile: Profile;
}

export function AccountDossierTab({ profile }: AccountDossierTabProps) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);

  function save(patch: Partial<Profile>) {
    saveProfile(patch);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  }

  const licenceOptions: SelectOption[] = LICENCE_TYPES.map((code) => ({
    value: code,
    label: t(`account.licenceOptions.${code}`),
  }));
  if (profile.licenceType && !LICENCE_TYPES.includes(profile.licenceType as never)) {
    licenceOptions.push({ value: profile.licenceType, label: profile.licenceType });
  }

  const roleOptions: SelectOption[] = USER_ROLES.map((r) => ({
    value: r,
    label: t(`account.roles.${r}`),
  }));
  if (profile.role && !(USER_ROLES as string[]).includes(profile.role)) {
    roleOptions.push({ value: profile.role, label: profile.role });
  }

  const activeAvatarSrc = profile.avatarUrl || '/img/captain-adel.jpg';

  return (
    <motion.div
      className={styles.hubContainer}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22 }}
    >
      <div className={styles.dossierStack}>
        {/* Header & Save Feedback */}
        <div className={styles.dossierDeckHead}>
          <div>
            <h2 className={styles.quickDeckTitle}>{t('account.pilotDossier')}</h2>
            <p className={styles.note}>{t('account.roleHint')}</p>
          </div>
          {saved && (
            <span className={styles.badgeConnected} role="status">
              <CheckCircle size={16} weight="fill" />
              <span>{t('account.saved')}</span>
            </span>
          )}
        </div>

        {/* ── Section 1: Pilot Identity & Avatar ── */}
        <div className={styles.dossierCard}>
          <div className={styles.dossierSectionTitle}>
            <UserCircle size={22} weight="duotone" color="var(--brand-hover)" />
            <h3>{t('account.avatarIdentity')}</h3>
          </div>

          <div className={styles.avatarDossierRow}>
            <div className={styles.avatarDossierLeft}>
              <div className={styles.avatarRingDossier}>
                <CaptainAvatar size="lg" src={activeAvatarSrc} glow live decorative />
              </div>
              <div>
                <strong>
                  {profile.avatarUrl ? t('account.customAvatar') : t('account.useAdelAvatar')}
                </strong>
                <p className={styles.note}>
                  {profile.avatarUrl
                    ? 'Using custom uploaded pilot photograph.'
                    : 'Using official Captain Adel portrait (Home Avatar).'}
                </p>
              </div>
            </div>

            <button
              type="button"
              className={styles.dossierAvatarBtn}
              onClick={() => setAvatarModalOpen(true)}
            >
              <ImageSquare size={16} />
              <span>{t('account.changeAvatar')}</span>
            </button>
          </div>

          <div className={styles.fieldsGrid}>
            <TextField
              label={t('account.name')}
              value={profile.displayName}
              onChange={(displayName) => save({ displayName })}
              placeholder="Capt. Callsign or Name"
            />

            <SelectField
              label={t('account.roleLabel')}
              value={profile.role}
              onChange={(role) => save({ role })}
              options={roleOptions}
              placeholder={t('account.roleSelect')}
            />
          </div>
        </div>

        {/* ── Section 2: Aviation Credentials & Licences ── */}
        <div className={styles.dossierCard}>
          <div className={styles.dossierSectionTitle}>
            <IdentificationBadge size={22} weight="duotone" color="var(--brand-hover)" />
            <h3>{t('account.aviationCredentials')}</h3>
          </div>

          <div className={styles.fieldsGrid}>
            <SelectField
              label={t('account.licence')}
              value={profile.licenceType}
              onChange={(licenceType) => save({ licenceType })}
              options={licenceOptions}
              placeholder={t('account.licenceSelect')}
            />

            <div>
              <TextField
                label={t('account.homeBase')}
                value={profile.homeBase}
                onChange={(homeBase) => save({ homeBase: homeBase.toUpperCase() })}
                placeholder={t('account.homeBasePlaceholder')}
              />
              {profile.homeBase && (
                <div className={styles.airportResolvedBadge}>
                  📍 {getAirportLabel(profile.homeBase)}
                </div>
              )}
            </div>
          </div>

          {/* Quick Select Saudi Airport Hubs */}
          <div className={styles.airportChipsSection}>
            <span className={styles.airportChipsLabel}>Major Saudi Hubs:</span>
            <div className={styles.airportChipsRow}>
              {MAJOR_SAUDI_AIRPORTS.slice(0, 5).map((apt) => (
                <button
                  key={apt.icao}
                  type="button"
                  className={`${styles.airportChip} ${
                    profile.homeBase === apt.icao ? styles.airportChipActive : ''
                  }`}
                  onClick={() => save({ homeBase: apt.icao })}
                >
                  <strong>{apt.icao}</strong>
                  <span>{apt.city}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Section 3: Regulatory Currency Dates ── */}
        <div className={styles.dossierCard}>
          <div className={styles.dossierSectionTitle}>
            <Clock size={22} weight="duotone" color="var(--brand-hover)" />
            <h3>{t('account.regulatoryDates')}</h3>
          </div>

          <div className={styles.fieldsGrid}>
            <TextField
              label={t('account.medicalExpiry')}
              value={profile.medicalExpiry}
              onChange={(medicalExpiry) => save({ medicalExpiry })}
              type="date"
            />

            <TextField
              label={t('account.lastFlightReview')}
              value={profile.lastFlightReview}
              onChange={(lastFlightReview) => save({ lastFlightReview })}
              type="date"
            />
          </div>
        </div>
      </div>

      {/* Avatar Customizer Modal */}
      <AvatarCustomizerModal
        isOpen={avatarModalOpen}
        currentAvatarUrl={profile.avatarUrl}
        onClose={() => setAvatarModalOpen(false)}
        onSave={(avatarUrl) => save({ avatarUrl })}
      />
    </motion.div>
  );
}
