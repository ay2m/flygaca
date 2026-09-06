import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, UploadSimple, LinkSimple, User } from '@phosphor-icons/react';
import { CaptainAvatar } from '@/components/CaptainAvatar';
import { Button } from '@/components/ui/Button';
import styles from './AccountPage.module.css';

interface AvatarCustomizerModalProps {
  isOpen: boolean;
  currentAvatarUrl?: string;
  onClose: () => void;
  onSave: (avatarUrl: string) => void;
}

const OFFICIAL_ADEL_AVATAR = '/img/captain-adel.jpg';

export function AvatarCustomizerModal({
  isOpen,
  currentAvatarUrl,
  onClose,
  onSave,
}: AvatarCustomizerModalProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine current selection mode
  const isCurrentlyAdel = !currentAvatarUrl || currentAvatarUrl === OFFICIAL_ADEL_AVATAR;
  const [selectedMode, setSelectedMode] = useState<'adel' | 'custom'>(
    isCurrentlyAdel ? 'adel' : 'custom',
  );
  const [customUrl, setCustomUrl] = useState<string>(
    !isCurrentlyAdel ? (currentAvatarUrl ?? '') : '',
  );
  const [previewError, setPreviewError] = useState(false);

  if (!isOpen) return null;

  const activePreview =
    selectedMode === 'adel' ? OFFICIAL_ADEL_AVATAR : customUrl.trim() || OFFICIAL_ADEL_AVATAR;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (JPG, PNG, or WebP).');
      return;
    }

    // Limit to 2.5MB
    if (file.size > 2.5 * 1024 * 1024) {
      alert('Image file size must be under 2.5 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setCustomUrl(dataUrl);
      setSelectedMode('custom');
      setPreviewError(false);
    };
    reader.readAsDataURL(file);
  };

  const handleApply = () => {
    if (selectedMode === 'adel') {
      onSave(''); // Empty string restores default Captain Adel
    } else {
      onSave(customUrl.trim());
    }
    onClose();
  };

  return (
    <AnimatePresence>
      <div className={styles.modalBackdrop} onClick={onClose} role="dialog" aria-modal="true">
        <motion.div
          className={styles.avatarModal}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
        >
          {/* Header */}
          <div className={styles.modalHeader}>
            <div className={styles.modalHeaderTitle}>
              <User size={22} weight="duotone" color="var(--brand-hover)" />
              <h3 className={styles.quickDeckTitle}>{t('account.avatarIdentity')}</h3>
            </div>
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <X size={18} />
            </button>
          </div>

          {/* Live Preview Display */}
          <div className={styles.avatarPreviewCenter}>
            <div className={styles.avatarPreviewFrame}>
              <CaptainAvatar
                size="xl"
                src={previewError ? OFFICIAL_ADEL_AVATAR : activePreview}
                glow
                decorative
              />
            </div>
            <p className={styles.avatarPreviewLabel}>
              {selectedMode === 'adel' ? t('account.useAdelAvatar') : t('account.customAvatar')}
            </p>
          </div>

          {/* Avatar Option Selector */}
          <div className={styles.avatarOptionGrid}>
            {/* Option 1: Official Captain Adel Portrait (Home page avatar) */}
            <button
              type="button"
              className={`${styles.avatarOptionCard} ${
                selectedMode === 'adel' ? styles.avatarOptionCardActive : ''
              }`}
              onClick={() => {
                setSelectedMode('adel');
                setPreviewError(false);
              }}
            >
              <div className={styles.avatarOptionHead}>
                <CaptainAvatar size="sm" src={OFFICIAL_ADEL_AVATAR} decorative />
                <div className={styles.avatarOptionInfo}>
                  <strong>{t('account.useAdelAvatar')}</strong>
                  <span>GACA Uniform & Cap (Official Home Avatar)</span>
                </div>
              </div>
              {selectedMode === 'adel' && (
                <div className={styles.avatarCheckBadge}>
                  <Check size={16} weight="bold" />
                </div>
              )}
            </button>

            {/* Option 2: Custom Photo Upload or Link */}
            <button
              type="button"
              className={`${styles.avatarOptionCard} ${
                selectedMode === 'custom' ? styles.avatarOptionCardActive : ''
              }`}
              onClick={() => setSelectedMode('custom')}
            >
              <div className={styles.avatarOptionHead}>
                <div className={styles.avatarOptionIconWrap}>
                  <UploadSimple size={22} weight="duotone" />
                </div>
                <div className={styles.avatarOptionInfo}>
                  <strong>{t('account.customAvatar')}</strong>
                  <span>Upload your pilot photograph or enter an image URL</span>
                </div>
              </div>
              {selectedMode === 'custom' && (
                <div className={styles.avatarCheckBadge}>
                  <Check size={16} weight="bold" />
                </div>
              )}
            </button>
          </div>

          {/* Custom Photo Controls */}
          {selectedMode === 'custom' && (
            <motion.div
              className={styles.customPhotoControls}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.18 }}
            >
              {/* File Upload Button */}
              <div className={styles.customUploadRow}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className={styles.hiddenFileInput}
                  onChange={handleFileChange}
                />
                <Button
                  type="button"
                  variant="clay"
                  icon={<UploadSimple size={16} />}
                  onClick={() => fileInputRef.current?.click()}
                  className={styles.fullWidth}
                >
                  {t('account.uploadPhoto')}
                </Button>
              </div>

              {/* URL Input */}
              <div className={styles.urlInputWrap}>
                <LinkSimple size={18} className={styles.urlInputIcon} />
                <input
                  type="url"
                  placeholder={t('account.customAvatarUrl') || 'https://...'}
                  value={customUrl}
                  onChange={(e) => {
                    setCustomUrl(e.target.value);
                    setPreviewError(false);
                  }}
                  className={styles.avatarUrlField}
                />
              </div>
            </motion.div>
          )}

          {/* Modal Footer */}
          <div className={styles.modalFooter}>
            <Button type="button" variant="clay" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="clayPrimary"
              onClick={handleApply}
              icon={<Check size={16} weight="bold" />}
            >
              {t('account.save')}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
