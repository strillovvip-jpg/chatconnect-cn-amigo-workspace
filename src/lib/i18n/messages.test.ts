import { describe, expect, it } from 'vitest';
import { messages } from './messages';

describe('messages multilingual coverage', () => {
  it('defines localized admin labels for every supported locale', () => {
    expect(messages.en.admin.tabs.dashboard).toBe('Overview');
    expect(messages.ja.admin.tabs.dashboard).toBe('概要');
    expect(messages['zh-Hans'].admin.tabs.dashboard).toBe('概览');
    expect(messages['zh-Hant'].admin.tabs.dashboard).toBe('概覽');
  });

  it('defines localized not-found page copy for every supported locale', () => {
    expect(messages.en.notFound.title).toBe('Page not found');
    expect(messages.ja.notFound.title).toBe('ページが見つかりません');
    expect(messages['zh-Hans'].notFound.title).toBe('找不到页面');
    expect(messages['zh-Hant'].notFound.title).toBe('找不到頁面');
  });

  it('defines localized video-source error strings', () => {
    expect(messages.en.videoSources.cameraTrackMissing).toBe(
      'No camera track was found for publishing.',
    );
    expect(messages.ja.videoSources.aiIosOnly).toBe(
      'AI 映像ソースは iOS アプリ内でのみ利用できます。',
    );
  });

  it('defines localized generic UI accessibility labels', () => {
    expect(messages.en.ui.carousel).toBe('Carousel');
    expect(messages.en.ui.previousPage).toBe('Previous page');
    expect(messages.ja.ui.nextSlide).toBe('次のスライド');
  });

  it('defines localized notification, call context, and call UI copy', () => {
    expect(messages.en.notification.title).toBe('Notification Center');
    expect(messages.ja.notification.answer).toBe('応答');
    expect(messages['zh-Hans'].callContext.shareStarted).toBe('屏幕共享已开始。');
    expect(messages['zh-Hant'].callContext.noAiPermission).toBe('此授權碼不允許使用 AI 視訊。');
    expect(messages.en.callUi.transferTitle).toBe('Transfer call');
    expect(messages.ja.callUi.sourceTitle).toBe('映像ソース');
  });

});
