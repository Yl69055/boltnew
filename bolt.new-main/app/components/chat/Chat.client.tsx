import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { fileModificationsToHTML } from '~/utils/diff';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';

// 导入 WebContainer
import { WebContainer } from '@webcontainer/api';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

// 新增 WebContainerPreview 组件，并添加类型定义
const WebContainerPreview: React.FC<{ url: string }> = ({ url }) => {
  return (
    <div style={{ width: '100%', height: '400px', border: '1px solid #ccc', marginTop: '20px' }}>
      <iframe src={url} style={{ width: '100%', height: '100%', border: 'none' }} />
    </div>
  );
};

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory } = useChatHistory();

  return (
    <>
      {ready && <ChatImpl initialMessages={initialMessages} storeMessageHistory={storeMessageHistory} />}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
}

export const ChatImpl = memo(({ initialMessages, storeMessageHistory }: ChatProps) => {
  useShortcuts();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [webContainerInstance, setWebContainerInstance] = useState<WebContainer | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);

  const { showChat } = useStore(chatStore);

  const [animationScope, animate] = useAnimate();

  const { messages, isLoading, input, handleInputChange, setInput, stop, append } = useChat({
    api: '/api/chat',
    onError: (error) => {
      logger.error('Chat request failed:', error);
      toast.error('There was an error processing your request');
    },
    onFinish: () => {
      logger.debug('Finished streaming');
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        handleBoltActions(lastMessage.content).catch((error) => {
          logger.error('Error handling bolt actions:', error);
          toast.error('Error processing AI response. Please try again.');
        });
      }
    },
    initialMessages,
  });

  const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
  const { parsedMessages, parseMessages } = useMessageParser();

  const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

  useEffect(() => {
    chatStore.setKey('started', initialMessages.length > 0);
  }, []);

  useEffect(() => {
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  }, [messages, isLoading, parseMessages]);

  // 初始化 WebContainer
  useEffect(() => {
    const initWebContainer = async () => {
      if (!webContainerInstance) {
        try {
          logger.debug('Initializing WebContainer...');
          const instance = await WebContainer.boot();
          setWebContainerInstance(instance);
          logger.debug('WebContainer initialized successfully');
        } catch (error) {
          logger.error('Failed to initialize WebContainer:', error);
          toast.error('Failed to initialize WebContainer. Please try again.');
        }
      }
    };

    initWebContainer();
  }, []);

  // 处理 boltArtifact 和 boltAction
  const handleBoltActions = async (content: string) => {
    if (!webContainerInstance) {
      logger.error('WebContainer not initialized');
      toast.error('WebContainer not initialized. Please try again.');
      return;
    }

    try {
      logger.debug('Parsing boltArtifact content...');
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'text/html');
      const boltArtifact = doc.querySelector('boltArtifact');

      if (boltArtifact) {
        logger.debug('Found boltArtifact, processing actions...');
        const actions = boltArtifact.querySelectorAll('boltAction');
        for (const action of actions) {
          const type = action.getAttribute('type');
          const filePath = action.getAttribute('filePath');
          const actionContent = action.textContent;

          if (type === 'file' && filePath && actionContent) {
            logger.debug(`Writing file: ${filePath}`);
            await webContainerInstance.fs.writeFile(filePath, actionContent);
          } else if (type === 'shell' && actionContent) {
            logger.debug(`Executing shell command: ${actionContent}`);
            const process = await webContainerInstance.spawn('sh', ['-c', actionContent]);
            process.output.pipeTo(new WritableStream({
              write(data) {
                logger.debug(`Shell output: ${data}`);
              }
            }));
            await process.exit;
          }
        }

        // 运行开发服务器
        logger.debug('Starting development server...');
        const serverProcess = await webContainerInstance.spawn('npm', ['run', 'dev']);
        serverProcess.output.pipeTo(new WritableStream({
          write(data) {
            logger.debug(`Server output: ${data}`);
            // 检查输出中是否包含本地服务器的 URL
            const match = data.match(/Local:\s+(http:\/\/localhost:\d+)/);
            if (match) {
              const url = match[1];
              logger.debug(`Setting preview URL: ${url}`);
              setPreviewUrl(url);
            }
          }
        }));
      } else {
        logger.warn('No boltArtifact found in the message');
      }
    } catch (error) {
      logger.error('Error processing boltActions:', error);
      toast.error('Error processing actions. Please try again.');
    }
  };

  const scrollTextArea = () => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight;
    }
  };

  const abort = () => {
    stop();
    chatStore.setKey('aborted', true);
    workbenchStore.abortAllActions();
  };

  useEffect(() => {
    const textarea = textareaRef.current;

    if (textarea) {
      textarea.style.height = 'auto';

      const scrollHeight = textarea.scrollHeight;

      textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
      textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
    }
  }, [input, textareaRef]);

  const runAnimation = async () => {
    if (chatStarted) {
      return;
    }

    await Promise.all([
      animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
      animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
    ]);

    chatStore.setKey('started', true);

    setChatStarted(true);
  };

  const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
    const _input = messageInput || input;

    if (_input.length === 0 || isLoading) {
      return;
    }

    await workbenchStore.saveAllFiles();

    const fileModifications = workbenchStore.getFileModifcations();

    chatStore.setKey('aborted', false);

    runAnimation();

    if (fileModifications !== undefined) {
      const diff = fileModificationsToHTML(fileModifications);
      append({ role: 'user', content: `${diff}\n\n${_input}` });
      workbenchStore.resetAllFileModifications();
    } else {
      append({ role: 'user', content: _input });
    }

    setInput('');

    resetEnhancer();

    textareaRef.current?.blur();
  };

  const [messageRef, scrollRef] = useSnapScroll();

  return (
    <>
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        messageRef={messageRef}
        scrollRef={scrollRef}
        handleInputChange={handleInputChange}
        handleStop={abort}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(input, (input) => {
            setInput(input);
            scrollTextArea();
          });
        }}
      />
      {previewUrl && <WebContainerPreview url={previewUrl} />}
    </>
  );
});
