import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { TextField } from '@/components/calc/TextField';
import { SelectField, type SelectOption } from '@/components/calc/SelectField';
import { Card } from '@/components/ui/Card';
import { saveProfile, USER_ROLES, type Profile } from '@/lib/services/account';
import styles from './AccountPage.module.css';

const LICENCE_TYPES = ['SPL', 'PPL', 'CPL', 'ATPL'] as const;

interface AccountDossierTabProps {
  profile: Profile;
}

export function AccountDossierTab({ profile }: AccountDossierTabProps) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);

  function save(patch: Partial<Profile>) {
    saveProfile(patch);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
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

  return (
    <motion.div
      className={styles.hubContainer}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22 }}
    >
      <Card variant="raised" className={styles.securityCard}>
        <div className={styles.bentoHeader}>
          <div>
            <h2 className={styles.quickDeckTitle}>{t('account.pilotDossier')}</h2>
            <p className={styles.note}>{t('account.roleHint')}</p>
          </div>
          {saved && (
            <span className={styles.badgeConnected} role="status">
              ✓ Saved
            </span>
          )}
        </div>

        <div className={styles.fields}>
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

          <TextField
            label={t('account.homeBase')}
            value={profile.homeBase}
            onChange={(homeBase) => save({ homeBase: homeBase.toUpperCase() })}
            placeholder={t('account.homeBasePlaceholder')}
          />

          <SelectField
            label={t('account.licence')}
            value={profile.licenceType}
            onChange={(licenceType) => save({ licenceType })}
            options={licenceOptions}
            placeholder={t('account.licenceSelect')}
          />

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
      </Card>
    </motion.div>
  );
}
