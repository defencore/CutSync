import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { appEnglish, translateDynamic } from './i18n-app';
import { timelineEnglish } from './i18n-timeline';

export type Language = 'uk' | 'en';
const inspectorEnglish: Record<string, string> = {
  'Інспектор кліпу': 'Clip inspector',
  'Інспектор': 'Inspector',
  'ТЕКСТ': 'TEXT',
  'КЛІП': 'CLIP',
  'ПРОЄКТ': 'PROJECT',
  'Субтитр': 'Subtitle',
  'Текст': 'Text',
  'Текст субтитру': 'Subtitle text',
  'Введіть текст…': 'Enter text…',
  'Початок, с': 'Start, s',
  'Кінець, с': 'End, s',
  'Стиль субтитрів': 'Subtitle style',
  'Розмір тексту': 'Font size',
  'Колір тексту': 'Text color',
  'Колір субтитрів': 'Subtitle color',
  'Темна підкладка': 'Dark background',
  'Підвищує читабельність': 'Makes text easier to read',
  'Стиль застосовується до всіх субтитрів проєкту.': 'The style applies to every subtitle in this project.',
  'Видалити субтитр': 'Delete subtitle',
  'Властивості кліпу': 'Clip properties',
  'Відео': 'Video',
  'Колір': 'Color',
  'Аудіо': 'Audio',
  'с': 's',
  'Монтаж': 'Editing',
  'Назва кліпу': 'Clip name',
  'На таймлайні, с': 'Timeline start, s',
  'Зміщення, с': 'Offset, s',
  'Тривалість, с': 'Duration, s',
  'Вхід у джерело, с': 'Source in, s',
  'Вихід із джерела, с': 'Source out, s',
  'Від’ємне значення починає звук раніше. Частина до 00:00 обрізається під час експорту.': 'A negative value starts audio earlier. The part before 00:00 is trimmed during export.',
  'Додатне значення затримує початок звуку відносно 00:00.': 'A positive value delays the audio start relative to 00:00.',
  'Доріжка': 'Track',
  'Відокремити звук': 'Detach audio',
  'Створює окремий аудіокліп і вимикає звук оригінального відео.': 'Creates a separate audio clip and mutes the original video.',
  'Трансформація': 'Transform',
  'Масштаб': 'Scale',
  'Поворот': 'Rotation',
  'Позиція X, %': 'Position X, %',
  'Позиція Y, %': 'Position Y, %',
  'Збільште масштаб і змістіть кадр, щоб обрізати краї.': 'Increase the scale and reposition the frame to crop its edges.',
  'Плавна поява та зникнення': 'Fade in and out',
  'Поява, с': 'Fade in, s',
  'Зникнення, с': 'Fade out, s',
  'Виділення області': 'Spotlight',
  'Затемнити навколо': 'Dim the surrounding area',
  'Ліворуч, %': 'Left, %',
  'Зверху, %': 'Top, %',
  'Ширина, %': 'Width, %',
  'Висота, %': 'Height, %',
  'Скинути відеоефекти': 'Reset video effects',
  'Образ кадру': 'Looks',
  'Оригінал': 'Original',
  'Кіно': 'Cinema',
  'Теплий': 'Warm',
  'Чорно-білий': 'B&W',
  'Основні налаштування': 'Basic adjustments',
  'Яскравість': 'Brightness',
  'Контраст': 'Contrast',
  'Насиченість': 'Saturation',
  'Температура': 'Temperature',
  'Розмиття': 'Blur',
  'Скинути корекцію кольору': 'Reset color adjustments',
  'Гучність': 'Volume',
  'Підсилення': 'Gain',
  'Нормалізація': 'Normalize',
  'Піковий рівень −1 dBFS': 'Peak level −1 dBFS',
  'Вимкнути звук кліпу': 'Mute clip',
  'Очищення звуку': 'Audio cleanup',
  'Придушення шуму': 'Noise reduction',
  'Оновити взірець шуму': 'Update noise sample',
  'Зняти взірець шуму': 'Capture noise sample',
  'Буде використано 0,5 с від курсора': 'Uses 0.5 s from the playhead',
  'Оберіть місце без голосу чи музики.': 'Choose a section without speech or music.',
  'Для цього джерела аудіодоріжка недоступна.': 'An audio track is unavailable for this source.',
  'Без взірця шум оцінюється за найтихішими ділянками.': 'Without a sample, noise is estimated from the quietest sections.',
  'Компресор': 'Compressor',
  'Вирівнює перепади гучності': 'Smooths out changes in volume',
  'Еквалайзер': 'Equalizer',
  'Мовлення': 'Speech',
  'Музика': 'Music',
  'Низькі частоти': 'Bass',
  'Високі частоти': 'Treble',
  'Зріз низьких частот': 'Low cut',
  'Зріз високих частот': 'High cut',
  'Синхронізація': 'Synchronization',
  'Синхронізувати за звуком': 'Sync by audio',
  'Зіставляє форму звукової хвилі з опорним кліпом.': 'Matches the audio waveform against a reference clip.',
  'Скинути аудіоефекти': 'Reset audio effects',
  'Видалити кліп': 'Delete clip',
  'Усе під вашим контролем': 'Every detail in your hands',
  'Оберіть кліп на таймлайні, щоб налаштувати відео, колір і звук.': 'Select a timeline clip to adjust video, color, and audio.',
  'Параметри проєкту': 'Project settings',
  'кадрів/с': 'fps',
  'Власний формат': 'Custom format',
  'Розрізати на курсорі': 'Split at playhead',
  'Обробка на вашому пристрої': 'Processed on your device',
};

export const englishTranslations: Record<string, string> = { ...appEnglish, ...timelineEnglish, ...inspectorEnglish };
type I18nValue = { language: Language; setLanguage: (language: Language) => void; t: (text: string) => string };
const I18nContext = createContext<I18nValue>({ language: 'uk', setLanguage: () => {}, t: text => text });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<Language>(() => {
    try { return localStorage.getItem('cutsync-language') === 'en' ? 'en' : 'uk'; } catch { return 'uk'; }
  });
  const setLanguage = useCallback((value: Language) => updateLanguage(value), []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'en' ? 'CutSync — browser editing studio' : 'CutSync — монтажна студія';
    try { localStorage.setItem('cutsync-language', language); } catch { /* Language selection remains available without persistent storage. */ }
  }, [language]);
  const t = useCallback((text: string) => language === 'en' ? englishTranslations[text] ?? translateDynamic(text) : text, [language]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export const useI18n = () => useContext(I18nContext);
