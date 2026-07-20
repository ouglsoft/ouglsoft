(function () {
  const translations = {
  "ar": {
    "pages": {
      "cta": {
        "playNow": "ابدأ اللعب الآن"
      },
      "nav": {
        "rules": "القواعد",
        "privacy": "الخصوصية",
        "terms": "شروط الاستخدام",
        "contact": "تواصل معنا"
      },
      "navShort": {
        "privacy": "الخصوصية",
        "terms": "الشروط",
        "contact": "تواصل"
      },
      "footer": {
        "text": "© ${year} العُقل للبرمجيات / El Ougl Software SARL — جميع الحقوق محفوظة"
      },
      "mode": {
        "title": "اختر نمط اللعب"
      }
    },
    "soufla": {
      "pick": {
        "toastNotOffender": "هذه القطعة ليست مخالِفة. اضغط على القطعة التي تجاهلت الأسر.",
        "title": "سوفلة على الخصم. اختر القطعة المخالِفة ثم حدِّد العقوبة.",
        "btnRemove": "إزالة",
        "btnForcePath": "إجبار على تنفيذ المسار ${n}"
      },
      "cpu": {
        "reason": "القطعة في ${offender}${startedFromPart} تجاهلت أطول مسار أسر (طوله ${len}).",
        "forcedPathLine": "${from} → ${path}",
        "penaltyRemove": "العقوبة: <b>إزالة</b> قطعتك عند ${cell}.",
        "revertNotice": "تمت إعادة نقلتك الأخيرة (السهم الأصفر).",
        "title": "سوفلة ضدك",
        "startedFromPart": " (بدأت من ${startedFrom})",
        "penaltyForceInline": "العقوبة: <b>إجبار</b> على الأسر: ${from} → ${path}.",
        "forcedPathIntro": "المسار المفروض للأسر:",
        "penaltyForcePicked": "العقوبة: <b>إجبار</b>."
      },
      "applied": {
        "force": "تم إجبار قطعة الخصم على تنفيذ المسار الأطول.",
        "remove": "تمت إزالة قطعة الخصم المخالفة.",
        "self": "تم تطبيق السوفلة"
      },
      "notCommitted": "تعذر تطبيق العقوبة (قد لا يكون هذا دورك أو حدث تعارض).",
      "sendFailed": "تعذر تطبيق العقوبة عبر الإنترنت.",
      "summary": {
        "force": "إجبارك على تنفيذ المسار من ${from} إلى ${to} بطول ${len}، وهو المسار المحدد بالسهم الأخضر.",
        "penaltyTitle": "واختار الخصم عقوبة:",
        "reason": "لقد قام الخصم بالمطالبة بسوفلة ضدك لأنك تجاهلت أسرًا صحيحًا، وهو المحدد بالسهم الأحمر/الأسهم الحمراء .",
        "remove": "إزالة قطعتك المخالفة عند النقطة ${cell} التي تحتوي علامة حمراء.",
        "title": "سوفلة :",
        "undo": "كما تم إرجاع نقلتك الأخيرة من النقطة ${from} إلى النقطة ${to} المحددة بالسهم الأصفر."
      }
    },
    "pvp": {
      "voice": {
        "micOn": "كتم الميكروفون",
        "spkOn": "كتم الصوت",
        "failed": "فشل الاتصال",
        "failedTitle": "فشل الدردشة الصوتية",
        "failure": {
          "permission": "تعذر الوصول إلى الميكروفون. اسمح للموقع باستخدامه ثم أعد المحاولة.",
          "noDevice": "لم يعثر المتصفح على ميكروفون متاح.",
          "busy": "تعذر فتح الميكروفون لأنه مستخدم أو غير متاح حاليًا.",
          "unsupported": "الدردشة الصوتية غير مدعومة في هذا المتصفح أو في هذا السياق.",
          "session": "تعذر بدء الدردشة الصوتية لأن جلسة المباراة غير جاهزة. أعد فتح المباراة ثم حاول مجددًا.",
          "service": "تعذر بدء الاتصال الصوتي الآن. تحقق من الاتصال ثم أعد المحاولة.",
          "generic": "تعذر تشغيل الدردشة الصوتية. حاول مرة أخرى."
        },
        "micOff": "فتح الميكروفون",
        "spkOff": "فتح الصوت",
        "mic": "الميكروفون",
        "speaker": "الصوت"
      },
      "chat": {
        "open": "الدردشة الكتابية",
        "empty": "لا توجد رسائل حاليًا.",
        "failed": "تعذر الإرسال. حاول مرة أخرى.",
        "placeholder": "اكتب رسالة...",
        "rateLimit": "أرسل رسالة واحدة كل ثانية.",
        "send": "إرسال",
        "title": "الدردشة الكتابية",
        "tooLong": "الحد الأقصى 200 حرف."
      },
      "leave": "مغادرة"
    },
    "advHelp": {
      "title": "شرح المستويات",
      "levelsIntro": "يعتمد اللعب ضد الحاسوب على محرك PVS/Alpha-Beta واحد ببحث تكراري وإدارة زمن تلقائية. حدود العمق المذكورة حدود أمان قصوى، وقد يتوقف البحث قبلها حسب الزمن وتعقيد الوضع. المستويات الأعلى تمنح المحرك وقتًا وعقدًا وذاكرة أكثر.",
      "levelsOnly": "تضبط المستويات زمن البحث وحدوده تلقائيًا. المستويات الأعلى أقوى عادة لكنها أبطأ، بينما قد تختار المستويات الأولى نقلة قانونية قريبة من الأفضل بعد استبعاد الخسائر التكتيكية الواضحة.",
      "levelDetails": {
        "beginner": "حد العمق: 7؛ زمن أساسي: 180 مللي ثانية؛ حد نهائي: 420 مللي ثانية؛ اختيار آمن من أفضل 4 نقلات متقاربة.",
        "easy": "حد العمق: 10؛ زمن أساسي: 500 مللي ثانية؛ حد نهائي: 1.1 ثانية؛ اختيار آمن من أفضل 3 نقلات متقاربة.",
        "medium": "حد العمق: 14؛ زمن أساسي: 1.4 ثانية؛ حد نهائي: 3 ثوانٍ؛ أفضل نقلة من آخر عمق مكتمل؛ المستوى الافتراضي.",
        "hard": "حد العمق: 18؛ زمن أساسي: 3.5 ثوانٍ؛ حد نهائي: 7 ثوانٍ؛ أفضل نقلة من آخر عمق مكتمل.",
        "strong": "حد العمق: 22؛ زمن أساسي: 7.5 ثوانٍ؛ حد نهائي: 15 ثانية؛ بحث كامل دون إضعاف اختياري.",
        "expert": "حد العمق: 28؛ زمن أساسي: 14 ثانية؛ حد نهائي: 26 ثانية؛ أعلى حدود البحث والذاكرة المتاحة."
      }
    },
    "auth": {
      "msgPopupBlocked": "تعذر فتح نافذة تسجيل Google. تأكد من السماح بالنوافذ المنبثقة.",
      "loginGoogleOption": "تسجيل الدخول عبر Google",
      "guestNoLogin": "المتابعة دون تسجيل الدخول",
      "msgResetNotAllowed": "استعادة كلمة المرور غير مفعلة في إعدادات المصادقة.",
      "msgSaved": "تم حفظ التعديلات.",
      "logoutFailed": "تعذر تسجيل الخروج. حاول مرة أخرى.",
      "brandFull": "لعبة ظامت الموريتانية",
      "send": "إرسال",
      "msgResetNoUser": "لا يوجد حساب مرتبط بهذا البريد.",
      "password": "كلمة المرور",
      "password2": "تأكيد كلمة المرور",
      "msgResetDomain": "لم يتم السماح بنطاق الموقع لإرسال رسالة الاستعادة. راجع إعدادات Google OAuth وCloudflare Worker.",
      "toRecover": "نسيت كلمة المرور؟",
      "save": "حفظ التعديلات",
      "nickname": "الاسم المستعار",
      "email": "البريد الإلكتروني",
      "registerTitle": "إنشاء حساب",
      "register": "تسجيل",
      "recoverTitle": "استرجاع كلمة المرور",
      "loginEmailOption": "تسجيل الدخول عبر البريد الإلكتروني",
      "toRegister": "إنشاء حساب",
      "msgResetTooMany": "تم حظر الطلب مؤقتًا لكثرة المحاولات. حاول لاحقًا.",
      "backLogin": "العودة لتسجيل الدخول",
      "msgResetInvalidEmail": "البريد الإلكتروني غير صالح.",
      "msgInvalid": "بيانات غير صحيحة.",
      "msgSent": "تم إرسال التعليمات إلى بريدك.",
      "msgNetwork": "تعذر الاتصال بالخدمة.",
      "seo": {
        "start": {
          "title": "ابدأ لعب ظامت بسهولة",
          "b1": "سجّل الدخول أو أنشئ حسابًا جديدًا، ويمكنك أيضًا المتابعة كضيف لتجربة اللعبة بسرعة.",
          "b2": "بعد الدخول يمكنك اختيار اللعب ضد الحاسوب أو لعب ظامت عبر الإنترنت مع لاعبين آخرين.",
          "b3": "إنشاء الحساب يمنحك ملفًا شخصيًا، وإحصائيات، وتجربة أكثر اكتمالًا داخل التطبيق.",
          "b4": "المتابعة كضيف مناسبة للتجربة السريعة، بينما يوفّر الحساب مزايا إضافية وتنظيمًا أفضل لتجربتك.",
          "b5": "ستجد في أسفل الصفحة روابط شروط الاستخدام، والخصوصية، والقواعد، ووسائل التواصل.",
          "small": "ابدأ بالطريقة التي تناسبك، ثم اختر نمط اللعب المناسب لك واستمتع بتجربة لعبة ظامت الموريتانية ضد الحاسوب أو عبر الإنترنت."
        },
        "what": {
          "title": "لعبة ظامت الموريتانية | Dhamet",
          "b1": "ظامت (Dhamet) لعبة موريتانية تقليدية تعتمد على التفكير والتخطيط وحسن قراءة الحركة.",
          "b2": "تُلعب على رقعة من نقاط ومسارات، وتختلف عن الداما الشائعة في شكل الرقعة واتجاهات اللعب وبعض القواعد الأساسية.",
          "b3": "تعتمد اللعبة على التمركز الجيد، واستغلال فرص الأسر، وحسن توقيت ترقية القطع إلى ظائم.",
          "b4": "تطبيق ظامت من إنشاء وتطوير العُقل للبرمجيات / El Ougl Software SARL، وهي الجهة المالكة لحقوقه، ويمكنكم زيارة موقع الشركة للتعرف على منتجاتها على الرابط التالي: <a href=\"https://ouglsoft.com\" target=\"_blank\" rel=\"noopener\">ouglsoft.com</a>.",
          "b5": "يمكنك التعرّف على قواعد ظامت، ثم بدء اللعب مباشرة من المتصفح على مختلف الأجهزة.",
          "small": "ظامت لعبة موريتانية تقليدية تعتمد على التفكير والتخطيط وحسن قراءة الحركة. تطبيق ظامت من إنشاء وتطوير العُقل للبرمجيات / El Ougl Software SARL، وهي الجهة المالكة لحقوقه. موقع الشركة: <a href=\"https://ouglsoft.com\" target=\"_blank\" rel=\"noopener\">ouglsoft.com</a>."
        }
      }
    },
    "buttons": {
      "newGame": "لعبة جديدة",
      "soufla": "سوفلة",
      "settings": "الإعدادات",
      "resume": "استئناف ",
      "home": "الرئيسية",
      "sync": "تحديث",
      "save": "حفظ ",
      "endKill": "إنهاء الأسر",
      "undo": "تراجع",
      "endMatch": "خروج",
    },
    "dashboard": {
      "draws": "التعادل",
      "losses": "الخسارة",
      "editEmail": "تغيير البريد",
      "title": "لوحة التحكم",
      "points": "النقاط",
      "editPass": "تغيير كلمة المرور",
      "editNick": "تغيير الاسم",
      "wins": "الفوز",
      "vsComputer": "ضد الحاسوب",
      "vsHumans": "ضد البشر",
      "totalGames": "إجمالي المباريات",
      "rank": "الترتيب",
      "matches": "المباريات",
      "total": "المجموع",
      "showLeaderboard": "عرض الترتيب العام",
      "leaderboard": {
        "title": "الترتيب العام",
        "empty": "لا توجد بيانات بعد."
      },
      "editIcon": "تغيير الصورة",
      "nameLabel": "الاسم",
      "deleteAccount": "حذف الحساب",
      "logoutConfirm": {
        "title": "تسجيل الخروج",
        "body": "هل تريد تسجيل الخروج؟"
      },
      "delete": {
        "title": "حذف الحساب",
        "body": "سيتم حذف الحساب وجميع البيانات المرتبطة به. أدخل كلمة المرور للتأكيد.",
        "passwordLabel": "كلمة المرور",
        "confirm": "حذف",
        "success": "تم حذف الحساب.",
        "failed": "تعذر حذف بيانات الحساب بالكامل. حاول مجددًا.",
        "wrongPassword": "كلمة المرور غير صحيحة.",
        "recentLogin": "تحتاج لإعادة تسجيل الدخول لحذف الحساب.",
        "googleNotSupported": "حساب Google لا يدعم حذف الحساب من داخل التطبيق. استخدم حساب بريد/كلمة مرور."
      },
      "password": {
        "googleNotSupported": "لا يمكن تغيير كلمة المرور لحساب Google.",
        "oldWrong": "كلمة المرور الحالية غير صحيحة.",
        "weak": "كلمة المرور الجديدة ضعيفة.",
        "recentLogin": "تحتاج لإعادة تسجيل الدخول لتعديل كلمة المرور.",
        "currentLabel": "كلمة المرور الحالية",
        "newLabel": "كلمة المرور الجديدة"
      }
    },
    "settings": {
      "board2d": "ثنائي الأبعاد",
      "pvpNotice": "وضع اللعب عبر الإنترنت: تم تعطيل خيار من يبدأ أولًا وإعدادات الحاسوب.",
      "board3d": "ثلاثي الأبعاد",
      "aiCapture": "أسر الحاسوب",
      "aiIgnoreRate": "نسبة العشوائية",
      "dark": "داكن",
      "coords": "إظهار ترقيم النقاط",
      "boardStyle": "شكل الرقعة",
      "shortcuts": "اختصارات: Enter تطبيق، Esc إغلاق.",
      "random": "عشوائي",
      "starter": "من يبدأ",
      "light": "فاتح",
      "mandatory": "إجباري",
      "theme": "الوضع البصري",
      "starterNextGameNote": "سيُطبَّق اختيار من يبدأ في اللعبة الجديدة فقط.",
      "aiLevel": "المستوى",
      "aiLevelHint": "يحدد قوة الحاسوب ووقت تفكيره تلقائيًا.",
      "aiLevelWithValue": "المستوى: ${level}",
      "aiLevelNextMoveNote": "سيُطبَّق ابتداءً من نقلة الحاسوب القادمة.",
      "enabled": "مفعّل",
      "disabled": "غير مفعّل",
      "aiLevelChangeTitle": "تغيير مستوى الحاسوب",
      "aiLevelChangeBody": "تغيير المستوى سيؤثر على إعدادات تفكير الحاسوب داخليًا. كلما كان المستوى أصعب، احتاج الحاسوب إلى وقت أطول للتفكير.",
      "levels": {
        "beginner": "مبتدئ",
        "easy": "سهل",
        "medium": "متوسط",
        "hard": "صعب",
        "strong": "قوي",
        "expert": "محترف"
      },
      "showCoords": "عرض الترقيم",
      "aiIgnoreHint": "تُستخدم فقط عند اختيار الأسر العشوائي."
    },
    "modals": {
      "gameOver": {
        "title": "نهاية المباراة",
        "winner": "انتهت المباراة. فاز اللاعب {player}.",
        "draw": "انتهت المباراة بالتعادل.",
        "reason": {
          "noPieces": "نفدت قطع اللاعب {player}.",
          "noLegalMoves": "لم يعد اللاعب {player} يملك نقلة قانونية.",
          "oneKingEach": "تحقق التعادل ببقاء ظائم واحد لكل لاعب."
        }
      },
      "newGame": {
        "title": "بدء لعبة جديدة",
        "confirm": "هل أنت متأكد من إنهاء اللعبة الحالية وبدء جديدة؟"
      },
      "endMatch": {
        "confirm": "هل تريد إنهاء المباراة؟"
      },
      "soufla": {
        "none": "لا توجد سوفلة في النقلة الأخيرة. النقلة قانونية.",
        "header": "السوفلة",
        "forcedOpeningWarning": "لا يمكن المطالبة بالسوفلة أثناء الافتتاح الإجباري."
      },
      "apply": "تطبيق",
      "yes": "نعم",
      "no": "لا",
      "forcedOpening": {
        "title": "الافتتاح الإجباري",
        "body": "في الافتتاح الإجباري تُنفَّذ 5 نقلات إلزامية لكل لاعب بالترتيب. النقلة الحالية موضَّحة بالسهم الأحمر. بعد ذلك يصبح اللعب حرًّا."
      },
      "notice": "تنبيه",
      "undo": {
        "notAllowedBody": "لا يمكن التراجع أثناء الافتتاح الإجباري.",
        "notAllowedTitle": "التراجع غير مسموح",
        "title": "تراجع"
      },
      "errorTitle": "خطأ",
      "pickOnlineNickTitle": "اختر اسمًا مستعارًا",
      "applySettings": {
        "title": "تطبيق الإعدادات",
        "noChanges": "لم يتم إجراء اي تغيير في الاعدادات",
        "applying": "جارٍ تطبيق الإعدادات...",
        "changedTitle": "الإعدادات التي تغيرت:",
        "applied": "تم تطبيق الإعدادات"
      },
      "successTitle": "نجاح"
    },
    "log": {
      "gameStarted": "بدأت المباراة.",
      "forced": {
        "openingStarted": "بدأ الافتتاح الإجباري.",
        "openingEnded": "انتهى الافتتاح الإجباري."
      },
      "save": {
        "none": "لا توجد لعبة محفوظة لاستئنافها",
        "done": "تم حفظ الوضعية الحالية للعبة",
        "confirm": "هل تريد إنهاء اللعبة الحالية واستئناف لعبة محفوظة سابقًا؟",
        "resumed": "تم استئناف اللعبة",
        "error": "تعذر استئناف اللعبة"
      },
      "results": {
        "savedOk": "تمت إضافة النتيجة إلى السجل بنجاح",
        "savedFail": "فشل إضافة النتيجة إلى السجل",
        "skipped": "تم تخطي إضافة النتيجة إلى السجل",
        "pvcCounted": "تمت إضافة نتيجة المباراة إلى الترتيب (${points} نقطة).",
        "pvcCountedCapped": "سُجّلت المباراة في الإحصاءات، لكن هذا المستوى بلغ الحد الأقصى للنقاط.",
        "pvcRejected": {
          "restored_from_save": "لم تُضف المباراة إلى النتائج لأنها استُكملت من مباراة محفوظة.",
          "incomplete_record": "لم تُضف المباراة إلى النتائج لأن سجلها غير مكتمل.",
          "too_many_undos": "لم تُضف المباراة إلى النتائج بسبب تجاوز الحد المسموح به للتراجع.",
          "non_counted_ending": "لم تُضف المباراة إلى النتائج لأن نهايتها لا تستوفي شروط الاحتساب.",
          "already_recorded": "سبق تسجيل نتيجة هذه المباراة.",
          "network_error": "تعذر تسجيل النتيجة بسبب مشكلة في الاتصال.",
          "pending_retry": "تعذر الاتصال مؤقتًا؛ حُفظت النتيجة على هذا الجهاز وستُرسل تلقائيًا عند عودة الاتصال.",
          "rate_limited": "تم بلوغ الحد المؤقت لنتائج اللعب ضد الحاسوب. حاول لاحقًا.",
          "unknown": "انتهت المباراة، لكن تعذر إضافتها إلى النتائج."
        }
      },
      "promote": "تتويج: ${cell} أصبح ظائم (${side})",
      "promoteActor": "${actor}: رقّى القطعة عند النقطة ${cell}.",
      "promoteSelf": "${actor}: رقّيت القطعة عند النقطة ${cell}.",
      "soufla": {
        "force": "سوفلة: إجبار ${from} على سلسلة (${path})",
        "remove": "سوفلة: إزالة ${cell}",
        "removePiece": "سوفلة: تمت إزالة القطعة ${piece} عند النقطة ${cell}.",
        "forcePiece": "سوفلة: أُجبرت القطعة ${piece} على الأسر من ${from} إلى ${to} (${n}).",
        "pressed": "ضغط على زر سوفلة",
        "pressedActor": "${actor}: ضغط على زر سوفلة.",
        "pressedSelf": "${actor}: ضغطت على زر سوفلة.",
        "removeActor": "${actor}: أزال بالسوفلة القطعة عند النقطة ${cell}.",
        "removeSelf": "${actor}: أزلت بالسوفلة القطعة عند النقطة ${cell}.",
        "forceActor": "${actor}: أجبر بالسوفلة القطعة على الأسر ${from}-${to} (${n}).",
        "forceSelf": "${actor}: أجبرت بالسوفلة القطعة على الأسر ${from}-${to} (${n})."
      },
      "pieceColorWhite": "البيضاء",
      "pieceColorBlack": "السوداء",
      "undoBySide": "تراجع ${side} عن النقلة.",
      "undoActor": "${actor}: تراجع عن النقلة.",
      "undoSelf": "${actor}: تراجعت عن النقلة.",
      "matchEndedByActor": "${actor}: أنهى المباراة.",
      "matchEndedBySelf": "${actor}: أنهيت المباراة.",
      "gameWinner": "انتهت المباراة. الفائز: ${winner}.",
      "gameDraw": "انتهت المباراة دون فائز.",
      "turnMoveFmt": "${side}: حركة ${from}-${to}.",
      "turnCaptureFmt": "${side}: أسر ${from}-${to} (${n})."
    },
    "mode": {
      "subtitle": "اختر الطريقة التي تفضّل أن تلعب بها: مواجهة فردية مع الحاسوب أو مباراة مباشرة مع لاعب آخر.",
      "pvcDesc": "ابدأ مباراة فردية في مواجهة محرك لعب ذكي، واختر مستوى الصعوبة المناسب لك.",
      "title": "اختر نمط اللعب",
      "pvpTitle": "اللعب عبر الإنترنت",
      "backToAccount": "العودة إلى الحساب",
      "pvpDesc": "ابحث عن لاعبين آخرين والعب ضدهم ، أو قم بمشاهدة مباريات جارية بشكل مباشر",
      "pvcTitle": "اللعب ضد الحاسوب"
    },
    "lobby": {
      "backToMode": "العودة إلى اختيار نمط اللعب",
      "refresh": "تحديث اللوبي",
      "emptyRooms": "لا توجد غرف جارية.",
      "emptyPlayers": "لا يوجد لاعبون متصلون.",
      "loadingPlayers": "جاري تحميل قائمة اللاعبين المتصلين.....",
      "loadingRooms": "جاري تحميل قائمة الغرف المباشرة...",
      "loadFailed": "تعذر تحميل اللوبي مؤقتًا. ستتم إعادة المحاولة تلقائيًا، ويمكنك الضغط على زر «تحديث» للمحاولة الآن.",
      "rooms": "قائمة الغرف النشطة",
      "subtitle": "شاهد المباريات الجارية أو اختر لاعبًا متصلًا وادعه إلى مباراة مباشرة.",
      "title": "قائمة الغرف واللاعبين المتصلين",
      "inviteDisabled": "لا يمكن دعوته الآن",
      "invitesDisabled": "معطل الدعوات",
      "noInvites": "لا يقبل الدعوات",
      "join": "دخول",
      "returnToMatch": "العودة إلى المباراة",
      "yourActiveMatch": "مباراتك النشطة",
      "reconnectingRoom": "اللاعبان يعيدان الاتصال",
      "privateRoom": "غرفة خاصة",
      "roomDefault": "غرفة",
      "roomLabel": "الغرفة",
      "spectate": "مشاهدة",
      "spectatorFull": "اكتمل عدد المشاهدين لهذه الغرفة."
    },
    "status": {
      "forcedChainStepByStep": "هذه نقلة افتتاحية بسلسلة أسر. نفّذ الأسر خطوة بخطوة.",
      "onlineInitFail": "تعذر تشغيل اللعب عبر الإنترنت الآن.",
      "reconnecting": "جارٍ استعادة الاتصال…",
      "loadingMatch": "جارٍ تحميل المباراة الرسمية…",
      "onlineInitHelp": "يرجى تسجيل الدخول أو بدء جلسة ضيف عبر Cloudflare.",
      "loading": "جارٍ التحميل…",
      "wait": "انتظر دورك...",
      "aiThinkingMove": "الحاسوب يفكّر…",
      "aiThinkingSoufla": "الحاسوب يفكر لاختيار عقوبة السوفلة...",
      "aiThinkingMoveWaitLine": "انتظر... الحاسوب يفكر في اختيار الحركة المناسبة.",
      "currentLevel": "المستوى الحالي",
      "aiThinkingMoveLevelDuration": "المستوى: ${level} (مدة تفكير الحاسوب من ${min} إلى ${max} ثانية لكل نقلة)",
      "turn": "الدور الآن على:",
      "forcedChainIncomplete": "أكمل سلسلة الأسر ثم اضغط «إنهاء الأسر».",
      "forcedMove": "الافتتاح الإجباري: النقلة المسموحة ${from}→${to}",
      "moveSendFail": "فشل إرسال النقلة، يرجى إعادتها من جديد.",
      "aiThinkingMoveLevelNote": "ملاحظة: كلما كان المستوى أعلى، قد يستغرق التفكير وقتًا أطول."
    },
    "players": {
      "player": "لاعب",
      "you": "أنت",
      "white": "⚪ الأبيض",
      "black": "⚫ الأسود",
      "computer": "الحاسوب"
    },
    "aria": {
      "board": "لوحة اللعب",
      "activityLog": "سجل النشاط",
      "controls": "عناصر التحكم",
      "mobileStats": "إحصاءات الهاتف",
      "pvpActions": "إجراءات اللعب ضد لاعب",
      "lobbyRooms": "الغرف",
      "lobbyPlayers": "اللاعبون",
      "dashboard": "لوحة التحكم",
      "stats": "الإحصاءات",
      "matchDetails": "تفاصيل المباراة",
      "editAccount": "تعديل الحساب",
      "authOverview": "نظرة عامة على ظامت",
      "authStart": "ابدأ لعب ظامت",
      "drawer": "الدرج",
      "orientationToggle": "تبديل اتجاه العرض",
      "drawerToggle": "تبديل الدرج",
      "fullscreen": "ملء الشاشة",
      "menu": "القائمة",
      "primaryNav": "التنقل الرئيسي"
    },
    "ui": {
      "stats": "الإحصائيات",
      "noUndo": "لا توجد حركة سابقة للتراجع عنها",
      "undoOwnLastOnly": "لا يمكن التراجع إلا عن آخر نقلة إذا كنت أنت من نفذها.",
      "language": "اللغة"
    },
    "meta_keywords": "ظامت, زامت, لعبة موريتانية, داما, لعب ضد الحاسوب, لعب عبر الإنترنت",
    "online": {
      "permissionDenied": "لا يمكن تنفيذ العملية الآن (صلاحيات Cloudflare غير كافية).",
      "authRestoreFailed": "تعذر استعادة تسجيل الدخول للحساب الآن. الرجاء إعادة تسجيل الدخول ثم المحاولة من جديد.",
      "connLimit": {
        "title": "الحد الأقصى للاتصالات",
        "body": "يوجد الآن الحد الأقصى المسموح به من الاتصالات (100 اتصال). نرجو منك الانتظار حتى يخرج أحد اللاعبين المتصلين ثم حاول مرة أخرى."
      },
      "presence": {
        "online": "متصل",
        "disconnected": "انقطع الاتصال"
      },
      "endFail": "تعذر إنهاء المباراة الآن.",
      "endPresentation": {
        "winner": "انتهت المباراة. فاز اللاعب {player}.",
        "draw": "انتهت المباراة بالتعادل.",
        "endedBy": "اللاعب {player} أنهى المباراة.",
        "endedByAbsence": "طلب اللاعب {player} إنهاء المباراة بعد استمرار غياب اللاعب {opponent}.",
        "noRecordedResult": "لم تُسجّل نتيجة للمباراة.",
        "roomUnavailable": "لم تعد الغرفة متاحة، وتعذر استرجاع نتيجة المباراة.",
        "reason": {
          "noPieces": "نفدت قطع اللاعب {player}.",
          "noLegalMoves": "لم يعد اللاعب {player} يملك نقلة قانونية.",
          "oneKingEach": "تحقق التعادل ببقاء ظائم واحد لكل لاعب.",
          "positionDecisive": "حُسمت المباراة لصالح الفائز لأن وضع المباراة كان حاسمًا عند الإنهاء."
        }
      },
      "errors": {
        "joinFailed": "تعذر الانضمام إلى المباراة عبر الإنترنت. تحقّق من صلاحيات قاعدة البيانات أو أعد المحاولة.",
        "noGame": "تم إنهاء المباراة أو تنظيف الغرفة.",
        "authRequired": "انتهت جلسة الدخول. أعد تسجيل الدخول ثم حاول مرة أخرى.",
        "presenceWriteDenied": "عاد الاتصال، لكن لم يكتمل تسجيل حضورك في الغرفة. تتم إعادة المزامنة.",
        "moveWriteDenied": "تعذر إرسال النقلة. تحقق من أنك اللاعب صاحب الدور وأن المباراة ما زالت نشطة.",
        "inviteWriteDenied": "تعذر إرسال الدعوة. قد يكون اللاعب دخل مباراة أو انتهت صلاحية الجلسة.",
        "chatWriteDenied": "تعذر إرسال الرسالة. يجب أن تكون لاعبا أو مشاهدا مسجلا في هذه الغرفة.",
        "voiceWriteDenied": "تعذر تحديث بيانات الصوت لهذه المباراة.",
        "matchEnded": "انتهت هذه المباراة، لذلك لا يمكن إرسال إجراء جديد.",
        "spectatorAction": "أنت مشاهد في هذه الغرفة ولا يمكنك تحريك القطع.",
        "spectatorJoinFailed": "تعذر تسجيلك كمشاهد في هذه الغرفة. أعد المحاولة."
      },
      "inviteInvalidated": "هذه الدعوة لم تعد صالحة لأن مرسلها دخل في مباراة أخرى أو لم يعد متصلًا.",
      "inviteRejected": "تم رفض الدعوة.",
      "inviteSendFail": "تعذر إرسال الدعوة.",
      "log": {
        "inviteAccepted": "{player} قبل الدعوة.",
        "inviteRejected": "{player} رفض الدعوة.",
        "inviteSent": "{from} أرسل دعوة إلى {to}."
      },
      "logFailed": "تعذر تحديث السجل.",
      "pvpEndTitle": "نهاية المباراة",
      "resultNotCounted": {
        "early": "لم يُحدَّد فائز لأن الانسحاب أو الغياب وقع قبل المرحلة المتقدمة.",
        "unclear": "لم يُحدَّد فائز لأن وضع المباراة لم يكن حاسمًا بما يكفي.",
        "generic": "انتهت المباراة دون اعتماد فائز."
      },
      "newInviteBody": "يدعوك اللاعب <strong>${fromName}</strong> للعب${roomPart}.",
      "newInviteRoomPart": " في غرفة <strong>${roomName}</strong>",
      "newInviteTitle": "دعوة جديدة",
      "noOpponent": "تعذر تحديد الخصم.",
      "noPlayers": "لم يتم العثور على لاعبين متصلين.",
      "offline": "انقطع اتصال الإنترنت… يتم إعادة المحاولة.",
      "absenceTitle": "غياب الخصم",
      "absencePrompt": "اللاعب {player} غير متصل منذ دقيقتين ، هل تريد الانتظار ام انهاء المباراة؟",
      "opponent": "الخصم",
      "player": "لاعب",
      "roomNamePlaceholder": "اسم الغرفة",
      "roomNamePrompt": "أدخل اسم الغرفة لتمييزها في قائمة الغرف.",
      "roomNameTitle": "تسمية الغرفة",
      "roomVisibility": {
        "public": "غرفة عامة (يسمح للمشاهدين بمتابعة المباراة)",
        "private": "غرفة خاصة (لا يسمح للمشاهدين بمتابعة المباراة)"
      },
      "invites": {
        "receiveLabel": "استقبال الدعوات:",
        "enabled": "مفعل",
        "disabled": "معطل",
        "enableReceiving": "تفعيل استقبال الدعوات",
        "receivingEnabled": "تم تفعيل استقبال الدعوات.",
        "receivingDisabled": "تم تعطيل استقبال الدعوات.",
        "notAccepting": "هذا اللاعب لا يقبل الدعوات حاليا.",
        "inActiveMatch": "أنت الآن في مباراة أونلاين نشطة. هل تريد مغادرة المباراة الحالية وإرسال الدعوة؟",
        "leaveActivePrompt": "أنت الآن في مباراة أونلاين نشطة. هل تريد مغادرة المباراة الحالية وإرسال الدعوة؟",
        "leaveAndSend": "المغادرة والإرسال",
        "returnToMatch": "العودة إلى المباراة"
      },
      "status": {
        "available": "متاح",
        "vsComputer": "يلعب ضد الحاسوب",
        "inPvP": "في مباراة أونلاين",
        "spectating": "يشاهد مباراة"
      },
      "syncFail": "فشلت المزامنة الآن، حاول مرة أخرى.",
      "syncIssueNotice": "يفضل تحديث الصفحة، توجد مشكلة في المزامنة",
      "waitingAcceptance": "لم يتم قبول الدعوة بعد.",
      "disabledButton": "لا يمكن تنفيذ هذا الإجراء لهذا اللاعب الآن.",
      "playersLoadFail": "تعذر تحميل قائمة اللاعبين المتصلين.",
      "playersTitle": "قائمة اللاعبين المتصلين"
    },
    "stats": {
      "left": "القطع المتبقية",
      "kings": "الظائم(الملك)",
      "captured": "المأسورة"
    },
    "spectator": {
      "only": "هذه المباراة بين لاعبين آخرين. أنت الآن مشاهد فقط ولا تملك صلاحية تحريك القطع."
    },
    "langs": {
      "en": "English",
      "ar": "العربية",
      "fr": "Français"
    },
    "chain": {
      "notice": {
        "body": "لإنهاء دورك اضغط «إنهاء الأسر/المؤقت». في السلسلة نفّذ الأسر خطوة بخطوة."
      }
    },
    "actions": {
      "ok": "موافق",
      "accept": "قبول",
      "continue": "متابعة",
      "invite": "دعوة",
      "reject": "رفض",
      "wait": "الانتظار",
      "cancel": "إلغاء",
      "close": "إغلاق",
      "back": "رجوع"
    },
    "meta_description": "نسخة ويب متقدمة من لعبة ظامت الموريتانية، تدعم اللعب ضد الحاسوب أو عبر الإنترنت بثلاث لغات.",
    "topbar": {
      "login": "تسجيل الدخول",
      "logout": "تسجيل الخروج",
      "account": "الحساب",
      "dashboard": "لوحة التحكم"
    },
    "page_title": "لعبة ظامت الموريتانية",
    "game": {
      "title": "لعبة ظامت الموريتانية"
    },
    "schema_game_genre": "لعبة استراتيجية",
    "schema_game_name": "ظامت الموريتانية",
    "schema_game_type": "Game",
    "undo": {
      "applied": "تم التراجع عن آخر نقلة${movePart}.",
      "appliedMovePart": " من ${from} إلى ${to}",
      "failed": "فشل تنفيذ التراجع",
      "notCommitted": "لم يتم تنفيذ التراجع.",
      "rejected": "اللاعب الآخر رفض التراجع.",
      "rejectedTitle": "رفض التراجع",
      "request": {
        "body": "{name} يريد التراجع عن النقلة الأخيرة، هل توافق؟",
        "title": "طلب تراجع"
      },
      "requestFailed": "تعذر إرسال طلب التراجع.",
      "wait": {
        "body": "لابد من موافقة اللاعب الآخر على التراجع عن النقلة السابقة، انتظر موافقته"
      }
    },
    "errors": {
      "nick": {
        "required": "الاسم المستعار مطلوب.",
        "tooShort": "الاسم المستعار قصير جدًا.",
        "tooLong": "الاسم المستعار طويل جدًا.",
        "invalid": "اسم مستعار غير صالح."
      },
      "db": {
        "permission": "صلاحيات غير كافية",
        "network": "مشكلة اتصال",
        "timeout": "انتهت مهلة الاتصال",
        "auth": "مشكلة مصادقة"
      }
    }

  },
  "en": {
    "pages": {
      "cta": {
        "playNow": "Start playing now"
      },
      "nav": {
        "rules": "Rules",
        "privacy": "Privacy",
        "terms": "Terms of Use",
        "contact": "Contact"
      },
      "navShort": {
        "privacy": "Privacy",
        "terms": "Terms",
        "contact": "Contact"
      },
      "footer": {
        "text": "© ${year} El Ougl Software SARL — All rights reserved."
      },
      "mode": {
        "title": "Game mode"
      }
    },
    "soufla": {
      "pick": {
        "toastNotOffender": "This piece isn’t an offender. Tap the piece that skipped a capture.",
        "title": "Soufla on your opponent. Tap the offending piece, then choose the penalty.",
        "btnRemove": "Remove",
        "btnForcePath": "Force path ${n}"
      },
      "cpu": {
        "reason": "The piece at ${offender}${startedFromPart} skipped the longest capture (length ${len}).",
        "forcedPathLine": "${from} → ${path}",
        "penaltyRemove": "Penalty: <b>remove</b> your piece at ${cell}.",
        "revertNotice": "Your last move was rolled back (yellow arrow).",
        "title": "Soufla against you",
        "startedFromPart": " (started from ${startedFrom})",
        "penaltyForceInline": "Penalty: <b>force</b> the capture path: ${from} → ${path}.",
        "forcedPathIntro": "Forced capture path:",
        "penaltyForcePicked": "Penalty: <b>force</b>."
      },
      "applied": {
        "force": "Opponent's piece was forced to take the longer path.",
        "remove": "Opponent's violating piece was removed.",
        "self": "Soufla applied."
      },
      "notCommitted": "Couldn't apply the penalty (it may not be your turn or a conflict occurred).",
      "sendFailed": "Failed to apply the penalty online.",
      "summary": {
        "force": "Forcing you to take the path from ${from} to ${to} with length ${len}, marked by the green arrow.",
        "penaltyTitle": "And the opponent chose the penalty:",
        "reason": "Your opponent claimed Soufla against you because you ignored a valid capture, marked by the red arrow(s) (the red arrow may be hidden under the green arrow when forcing is chosen).",
        "remove": "Removing your violating piece at ${cell}, marked in red.",
        "title": "Soufla:",
        "undo": "Also undoing your last move from ${from} to ${to}, marked by the yellow arrow."
      }
    },
    "pvp": {
      "voice": {
        "micOn": "Mute mic",
        "spkOn": "Mute",
        "failed": "Connection failed",
        "failedTitle": "Voice chat failed",
        "failure": {
          "permission": "The microphone could not be accessed. Allow microphone access for this site, then try again.",
          "noDevice": "No available microphone was found.",
          "busy": "The microphone could not be opened because it is busy or currently unavailable.",
          "unsupported": "Voice chat is not supported by this browser or in this context.",
          "session": "Voice chat could not start because the match session is not ready. Reopen the match and try again.",
          "service": "The voice connection could not start now. Check your connection and try again.",
          "generic": "Voice chat could not start. Try again."
        },
        "micOff": "Turn on microphone",
        "spkOff": "Turn on sound",
        "mic": "Mic",
        "speaker": "Sound"
      },
      "chat": {
        "open": "Chat",
        "empty": "No messages yet.",
        "failed": "Failed to send. Try again.",
        "placeholder": "Type a message…",
        "rateLimit": "Send one message per second.",
        "send": "Send",
        "title": "Chat",
        "tooLong": "Max 200 characters."
      },
      "leave": "Leave"
    },
    "advHelp": {
      "title": "Level guide",
      "levelsIntro": "Computer play uses one iterative-deepening PVS/Alpha-Beta engine with automatic time management. The listed depths are safety ceilings; search may stop earlier according to time and position complexity. Higher levels receive more time, nodes, and memory.",
      "levelsOnly": "Levels automatically control search time and safety limits. Higher levels are usually stronger but slower; lower levels may choose a near-best legal move only after obvious tactical losses are filtered out.",
      "levelDetails": {
        "beginner": "Depth ceiling: 7; base time: 180 ms; hard limit: 420 ms; safe choice among up to 4 close moves.",
        "easy": "Depth ceiling: 10; base time: 500 ms; hard limit: 1.1 s; safe choice among up to 3 close moves.",
        "medium": "Depth ceiling: 14; base time: 1.4 s; hard limit: 3 s; best move from the last completed iteration; default level.",
        "hard": "Depth ceiling: 18; base time: 3.5 s; hard limit: 7 s; best move from the last completed iteration.",
        "strong": "Depth ceiling: 22; base time: 7.5 s; hard limit: 15 s; full-strength move selection.",
        "expert": "Depth ceiling: 28; base time: 14 s; hard limit: 26 s; highest search and memory limits."
      }
    },
    "auth": {
      "msgPopupBlocked": "Couldn't open Google sign-in window. Please allow pop-ups.",
      "loginGoogleOption": "Sign in with Google",
      "guestNoLogin": "Continue without signing in",
      "msgResetNotAllowed": "Password reset is not enabled in authentication settings.",
      "msgSaved": "Changes saved.",
      "logoutFailed": "Sign-out failed. Please try again.",
      "brandFull": "Mauritanian Dhamet Game",
      "send": "Send",
      "msgResetNoUser": "No account found for this email.",
      "password": "Password",
      "password2": "Confirm password",
      "msgResetDomain": "This domain isn't authorized for password reset. Check Google OAuth and Cloudflare Worker settings.",
      "toRecover": "Forgot password?",
      "save": "Save changes",
      "nickname": "Nickname",
      "email": "Email",
      "registerTitle": "Create account",
      "register": "Sign up",
      "recoverTitle": "Password reset",
      "loginEmailOption": "Sign in with email",
      "toRegister": "Create account",
      "msgResetTooMany": "Too many attempts. Try again later.",
      "backLogin": "Back to sign in",
      "msgResetInvalidEmail": "Invalid email address.",
      "msgInvalid": "Invalid credentials.",
      "msgSent": "Instructions sent to your email.",
      "msgNetwork": "Could not reach the service.",
      "seo": {
        "start": {
          "title": "Start Playing Dhamet Easily",
          "b1": "Sign in or create a new account, and you can also continue as a guest for a quick trial.",
          "b2": "After signing in, you can choose to play against the computer or play Dhamet online with other players.",
          "b3": "Creating an account gives you a personal profile, statistics, and a more complete experience inside the app.",
          "b4": "Continuing as a guest is suitable for a quick try, while an account gives you extra features and better organization for your experience.",
          "b5": "At the bottom of the page you will find links to the terms of use, privacy policy, rules, and contact options.",
          "small": "Start in the way that suits you, then choose the play mode that fits you and enjoy the Mauritanian Dhamet game against the computer or online."
        },
        "what": {
          "title": "Mauritanian Dhamet Game | Dhamet",
          "b1": "Dhamet is a traditional Mauritanian game built on thinking, planning, and reading movement well.",
          "b2": "It is played on a board of points and paths, and it differs from common checkers in board shape, directions of play, and some core rules.",
          "b3": "The game depends on good positioning, using capture opportunities, and choosing the right moment to promote pieces into Dhaim.",
          "b4": "The Dhamet application was created and developed by العُقل للبرمجيات / El Ougl Software SARL, the rights holder. You can visit the company website to learn about its products: <a href=\"https://ouglsoft.com\" target=\"_blank\" rel=\"noopener\">ouglsoft.com</a>.",
          "b5": "You can learn the rules of Dhamet, then start playing directly from the browser on different devices.",
          "small": "Dhamet is a traditional Mauritanian strategy game based on thinking, planning, and reading movement well. The application was created and developed by El Ougl Software SARL. Company website: <a href=\"https://ouglsoft.com\" target=\"_blank\" rel=\"noopener\">ouglsoft.com</a>."
        }
      }
    },
    "buttons": {
      "newGame": "New ",
      "soufla": "Soufla",
      "settings": "Settings",
      "home": "Home",
      "resume": "Resume",
      "sync": "Refresh",
      "save": "Save",
      "endKill": "End capture",
      "undo": "Undo",
      "endMatch": "Exit",
    },
    "dashboard": {
      "draws": "Draws",
      "losses": "Losses",
      "editEmail": "Change email",
      "title": "Dashboard",
      "points": "Points",
      "editPass": "Change password",
      "editNick": "Change name",
      "wins": "Wins",
      "vsComputer": "Vs computer",
      "vsHumans": "Vs humans",
      "totalGames": "Total games",
      "rank": "Rank",
      "matches": "Matches",
      "total": "Total",
      "showLeaderboard": "Show leaderboard",
      "leaderboard": {
        "title": "Leaderboard",
        "empty": "No data yet."
      },
      "editIcon": "Change picture",
      "nameLabel": "Name",
      "deleteAccount": "Delete account",
      "logoutConfirm": {
        "title": "Sign out",
        "body": "Do you want to sign out?"
      },
      "delete": {
        "title": "Delete account",
        "body": "This will delete your account and all related data. Enter your password to confirm.",
        "passwordLabel": "Password",
        "confirm": "Delete",
        "success": "Your account has been deleted.",
        "failed": "Could not delete all account data. Please try again.",
        "wrongPassword": "Incorrect password.",
        "recentLogin": "Please sign in again to delete your account.",
        "googleNotSupported": "Google accounts can’t be deleted from inside the app. Use an email/password account."
      },
      "password": {
        "googleNotSupported": "You can't change the password for a Google account.",
        "oldWrong": "The current password is incorrect.",
        "weak": "The new password is too weak.",
        "recentLogin": "Please sign in again to change your password.",
        "currentLabel": "Current password",
        "newLabel": "New password"
      }
    },
    "settings": {
      "board2d": "2D",
      "pvpNotice": "Online mode: starter selection and computer settings are disabled.",
      "board3d": "3D",
      "aiCapture": "Computer capture rule",
      "aiIgnoreRate": "Ignore-capture rate",
      "dark": "Dark",
      "coords": "Show point numbering",
      "boardStyle": "Board style",
      "shortcuts": "Shortcuts: Enter = Apply, Esc = Close",
      "random": "Random",
      "starter": "Starting player",
      "light": "Light",
      "mandatory": "Mandatory",
      "theme": "Theme",
      "starterNextGameNote": "The starting player setting applies to the next new game only.",
      "aiLevel": "Level",
      "aiLevelHint": "Automatically controls computer strength and thinking time.",
      "aiLevelWithValue": "Level: ${level}",
      "aiLevelNextMoveNote": "Applies starting from the computer’s next move.",
      "enabled": "Enabled",
      "disabled": "Disabled",
      "aiLevelChangeTitle": "Change computer level",
      "aiLevelChangeBody": "Changing the level will affect the computer thinking settings internally. The harder the level, the more time the computer may need to think.",
      "levels": {
        "beginner": "Beginner",
        "easy": "Easy",
        "medium": "Medium",
        "hard": "Hard",
        "strong": "Strong",
        "expert": "Expert"
      },
      "showCoords": "Show coordinates",
      "aiIgnoreHint": "Used only when computer capture is set to random."
    },
    "modals": {
      "gameOver": {
        "title": "Match result",
        "winner": "The match ended. Player {player} won.",
        "draw": "The match ended in a draw.",
        "reason": {
          "noPieces": "Player {player} ran out of pieces.",
          "noLegalMoves": "Player {player} had no legal move left.",
          "oneKingEach": "The draw was reached with one king remaining for each player."
        }
      },
      "newGame": {
        "title": "New game",
        "confirm": "Start a new game and end the current one?"
      },
      "endMatch": {
        "confirm": "Do you want to end the match?"
      },
      "soufla": {
        "none": "No soufla on the last move. It was legal.",
        "header": "Soufla",
        "forcedOpeningWarning": "No soufla during the forced opening."
      },
      "apply": "Apply",
      "yes": "Yes",
      "no": "No",
      "forcedOpening": {
        "title": "Forced opening",
        "body": "Forced opening: each player must play 5 mandatory moves in order. The current move is marked with the red arrow. After that, play is free."
      },
      "notice": "Notice",
      "undo": {
        "notAllowedBody": "You can’t undo during the forced opening.",
        "notAllowedTitle": "Undo not allowed",
        "title": "Undo"
      },
      "errorTitle": "Error",
      "pickOnlineNickTitle": "Choose a nickname",
      "applySettings": {
        "title": "Apply settings",
        "noChanges": "No settings were changed.",
        "applying": "Applying settings...",
        "changedTitle": "Changed settings:",
        "applied": "Settings applied"
      },
      "successTitle": "Success"
    },
    "log": {
      "gameStarted": "The match started.",
      "forced": {
        "openingStarted": "Forced opening started.",
        "openingEnded": "Forced opening ended."
      },
      "save": {
        "none": "No saved game to resume.",
        "done": "Game state saved.",
        "confirm": "Do you want to end the current game and resume a previously saved one?",
        "resumed": "Game resumed.",
        "error": "Could not resume the game."
      },
      "results": {
        "savedOk": "Result added to history successfully.",
        "savedFail": "Failed to add result to history.",
        "skipped": "Skipped adding the result to the log",
        "pvcCounted": "The match was added to the ranking (${points} points).",
        "pvcCountedCapped": "The match was recorded in statistics, but this level has reached its points limit.",
        "pvcRejected": {
          "restored_from_save": "The match was not added because it was resumed from a saved game.",
          "incomplete_record": "The match was not added because its record is incomplete.",
          "too_many_undos": "The match was not added because the undo limit was exceeded.",
          "non_counted_ending": "The match was not added because its ending does not meet the scoring conditions.",
          "already_recorded": "This match result was already recorded.",
          "network_error": "The result could not be recorded because of a network problem.",
          "pending_retry": "The connection is temporarily unavailable. The result was saved on this device and will be retried automatically.",
          "rate_limited": "The temporary limit for computer-match results has been reached. Try again later.",
          "unknown": "The match ended, but it could not be added to the results."
        }
      },
      "promote": "Promotion: ${cell} became a king (${side})",
      "promoteActor": "${actor}: Promoted the piece at ${cell}.",
      "promoteSelf": "${actor}: Promoted the piece at ${cell}.",
      "soufla": {
        "force": "Soufla: forcing ${from} to follow a chain (${path})",
        "remove": "Soufla: remove ${cell}",
        "removePiece": "Soufla: the ${piece} piece was removed at ${cell}.",
        "forcePiece": "Soufla: the ${piece} piece was forced to capture from ${from} to ${to} (${n}).",
        "pressed": "Pressed the Soufla button",
        "pressedActor": "${actor}: Pressed the Soufla button.",
        "pressedSelf": "${actor}: Pressed the Soufla button.",
        "removeActor": "${actor}: Removed the piece with Soufla at ${cell}.",
        "removeSelf": "${actor}: Removed the piece with Soufla at ${cell}.",
        "forceActor": "${actor}: Forced the piece with Soufla to capture ${from}-${to} (${n}).",
        "forceSelf": "${actor}: Forced the piece with Soufla to capture ${from}-${to} (${n})."
      },
      "pieceColorWhite": "white",
      "pieceColorBlack": "black",
      "undoBySide": "${side} undid the move.",
      "undoActor": "${actor}: Undid the move.",
      "undoSelf": "${actor}: Undid the move.",
      "matchEndedByActor": "${actor}: Ended the match.",
      "matchEndedBySelf": "${actor}: Ended the match.",
      "gameWinner": "The match ended. Winner: ${winner}.",
      "gameDraw": "The match ended without a winner.",
      "turnMoveFmt": "${side}: Move ${from}-${to}.",
      "turnCaptureFmt": "${side}: Capture ${from}-${to} (${n})."
    },
    "mode": {
      "subtitle": "Choose to play vs the computer, or online to face other players or watch matches live.",
      "pvcDesc": "Start a solo match against an intelligent game engine and choose the difficulty that suits you.",
      "title": "Choose game mode",
      "pvpTitle": "Play Online",
      "backToAccount": "Back to account",
      "pvpDesc": "Enter the lobby and play with others.",
      "pvcTitle": "Play vs Computer"
    },
    "lobby": {
      "backToMode": "Back to mode selection",
      "refresh": "Refresh lobby",
      "emptyRooms": "No active rooms.",
      "emptyPlayers": "No players online.",
      "loadingPlayers": "Loading online players...",
      "loadingRooms": "Loading live rooms...",
      "loadFailed": "The lobby could not be loaded temporarily. It will retry automatically, or press Refresh to try now.",
      "rooms": "Active rooms list",
      "subtitle": "Choose a room to watch, or invite a player to start a match.",
      "title": "Rooms & online players",
      "inviteDisabled": "Can't invite right now",
      "invitesDisabled": "Invites disabled",
      "noInvites": "Doesn't accept invites",
      "join": "Join",
      "returnToMatch": "Return to match",
      "yourActiveMatch": "Your active match",
      "reconnectingRoom": "Players are reconnecting",
      "privateRoom": "Private room",
      "roomDefault": "Room",
      "roomLabel": "Room",
      "spectate": "Spectate",
      "spectatorFull": "Spectator slots are full for this room."
    },
    "status": {
      "forcedChainStepByStep": "Forced-opening chain capture: take step by step.",
      "onlineInitFail": "Online play could not be initialized right now.",
      "reconnecting": "Restoring the connection…",
      "loadingMatch": "Loading the official match…",
      "onlineInitHelp": "Please sign in or start a Cloudflare guest session.",
      "loading": "Loading…",
      "wait": "Wait for your turn...",
      "aiThinkingMove": "Computer is thinking…",
      "aiThinkingSoufla": "Computer is choosing a Soufla penalty…",
      "aiThinkingMoveWaitLine": "Please wait… The computer is thinking about the appropriate move.",
      "currentLevel": "Current level",
      "aiThinkingMoveLevelDuration": "Level: ${level} (computer thinking time from ${min} to ${max} seconds per move)",
      "turn": "Turn:",
      "forcedChainIncomplete": "Finish the capture chain, then press “End capture”.",
      "forcedMove": "Forced opening: the allowed move is ${from}→${to}",
      "moveSendFail": "Failed to send the move. Please retry it again.",
      "aiThinkingMoveLevelNote": "Note: higher levels may take longer to think."
    },
    "players": {
      "player": "Player",
      "you": "You",
      "white": "⚪ White",
      "black": "⚫ Black",
      "computer": "Computer"
    },
    "aria": {
      "board": "Game board",
      "activityLog": "Activity log",
      "controls": "Controls",
      "mobileStats": "Mobile stats",
      "pvpActions": "PvP actions",
      "lobbyRooms": "Rooms",
      "lobbyPlayers": "Players",
      "dashboard": "Dashboard",
      "stats": "Stats",
      "matchDetails": "Match details",
      "editAccount": "Edit account",
      "authOverview": "Dhamet overview",
      "authStart": "Start playing Dhamet",
      "drawer": "Drawer",
      "orientationToggle": "Toggle display orientation",
      "drawerToggle": "Toggle drawer",
      "fullscreen": "Fullscreen",
      "menu": "Menu",
      "primaryNav": "Primary navigation"
    },
    "ui": {
      "stats": "Stats",
      "noUndo": "Nothing to undo.",
      "undoOwnLastOnly": "You can undo the last move only if you made it.",
      "language": "Language"
    },
    "meta_keywords": "zamat, zamet, mauritanian game, board game, checkers, draughts, computer play, online multiplayer",
    "online": {
      "permissionDenied": "Cannot perform this action now (insufficient Cloudflare permissions).",
      "authRestoreFailed": "Could not restore account sign-in right now. Please sign in again and try once more.",
      "connLimit": {
        "title": "Maximum connections",
        "body": "The maximum allowed number of connections (100) has been reached. Please wait until one of the connected players leaves, then try again."
      },
      "presence": {
        "online": "Online",
        "disconnected": "Disconnected"
      },
      "endFail": "Couldn't end the match right now.",
      "endPresentation": {
        "winner": "The match ended. Player {player} won.",
        "draw": "The match ended in a draw.",
        "endedBy": "Player {player} ended the match.",
        "endedByAbsence": "Player {player} requested to end the match after player {opponent} remained absent.",
        "noRecordedResult": "No result was recorded for the match.",
        "roomUnavailable": "The room is no longer available, and the match result could not be retrieved.",
        "reason": {
          "noPieces": "Player {player} ran out of pieces.",
          "noLegalMoves": "Player {player} had no legal move left.",
          "oneKingEach": "The draw was reached with one king remaining for each player.",
          "positionDecisive": "The match was decided in favor of the winner because the position was decisive when it ended."
        }
      },
      "errors": {
        "joinFailed": "Couldn't join the online match. Check Cloudflare backend permissions or try again.",
        "noGame": "The match has ended or the room was cleaned.",
        "authRequired": "Your sign-in session ended. Sign in again, then try once more.",
        "presenceWriteDenied": "Connection is back, but your room presence was not restored yet. Resyncing now.",
        "moveWriteDenied": "Couldn't send the move. Make sure you are the player to move and the match is still active.",
        "inviteWriteDenied": "Couldn't send the invite. The player may have entered a match, or your session expired.",
        "chatWriteDenied": "Couldn't send the message. You must be registered as a player or spectator in this room.",
        "voiceWriteDenied": "Couldn't update voice data for this match.",
        "matchEnded": "This match has ended, so no new action can be sent.",
        "spectatorAction": "You are a spectator in this room and cannot move the pieces.",
        "spectatorJoinFailed": "Couldn't register you as a spectator in this room. Try again."
      },
      "inviteInvalidated": "This action could not be completed because the other player joined another match or is no longer online.",
      "inviteRejected": "The invite was rejected.",
      "inviteSendFail": "Couldn't send the invite.",
      "log": {
        "inviteAccepted": "{player} accepted the invite.",
        "inviteRejected": "{player} rejected the invite.",
        "inviteSent": "{from} sent an invite to {to}."
      },
      "logFailed": "Failed to update the log.",
      "pvpEndTitle": "Match ended",
      "resultNotCounted": {
        "early": "No winner was declared because the withdrawal or absence occurred before the advanced stage.",
        "unclear": "No winner was declared because the position was not decisive enough.",
        "generic": "The match ended without an official winner."
      },
      "newInviteBody": "Player <strong>${fromName}</strong> invited you to play${roomPart}.",
      "newInviteRoomPart": " in room <strong>${roomName}</strong>",
      "newInviteTitle": "New invite",
      "noOpponent": "Couldn't identify the opponent.",
      "noPlayers": "No online players found.",
      "offline": "Internet connection lost… retrying.",
      "absenceTitle": "Opponent absent",
      "absencePrompt": "Player {player} has been offline for two minutes. Do you want to wait or end the match?",
      "opponent": "Opponent",
      "player": "Player",
      "roomNamePlaceholder": "Room name",
      "roomNamePrompt": "Enter a room name to distinguish it in the rooms list.",
      "roomNameTitle": "Name the room",
      "roomVisibility": {
        "public": "Public room (spectators can watch the match)",
        "private": "Private room (spectators cannot watch the match)"
      },
      "invites": {
        "receiveLabel": "Invite receiving:",
        "enabled": "Enabled",
        "disabled": "Disabled",
        "enableReceiving": "Enable invite receiving",
        "receivingEnabled": "Invite receiving enabled.",
        "receivingDisabled": "Invite receiving disabled.",
        "notAccepting": "This player is not accepting invites right now.",
        "inActiveMatch": "You are currently in an active online match. Do you want to leave the current match and send the invite?",
        "leaveActivePrompt": "You are currently in an active online match. Do you want to leave the current match and send the invite?",
        "leaveAndSend": "Leave and send",
        "returnToMatch": "Return to match"
      },
      "status": {
        "available": "Available",
        "vsComputer": "Playing vs computer",
        "inPvP": "In online match",
        "spectating": "Watching a match"
      },
      "syncFail": "Sync failed. Try again.",
      "syncIssueNotice": "It is better to refresh the page. There is a synchronization problem.",
      "waitingAcceptance": "Invite hasn't been accepted yet.",
      "disabledButton": "This action is not available for this player right now.",
      "playersLoadFail": "Could not load the online players list.",
      "playersTitle": "Connected players list"
    },
    "stats": {
      "left": "Pieces left",
      "kings": "Kings",
      "captured": "Captured"
    },
    "spectator": {
      "only": "This match is between two other players. You are currently a spectator only and are not allowed to move the pieces."
    },
    "langs": {
      "en": "English",
      "ar": "العربية",
      "fr": "Français"
    },
    "chain": {
      "notice": {
        "body": "To end your turn, press “End capture / Timer”. In a capture chain, capture step by step."
      }
    },
    "actions": {
      "ok": "OK",
      "accept": "Accept",
      "continue": "Continue",
      "invite": "Invite",
      "reject": "Reject",
      "wait": "Wait",
      "cancel": "Cancel",
      "close": "Close",
      "back": "Back"
    },
    "meta_description": "An advanced web version of the Mauritanian game Zamat. Play against the computer or online in Arabic, English, and French.",
    "topbar": {
      "logout": "Sign out",
      "account": "Account",
      "dashboard": "Dashboard",
      "login": "Log in"
    },
    "page_title": "Mauritanian Zamat",
    "game": {
      "title": "Mauritanian Dhamet game"
    },
    "schema_game_name": "Mauritanian Zamat",
    "schema_game_genre": "Strategy game",
    "schema_game_type": "Game",
    "undo": {
      "applied": "Last move was undone${movePart}.",
      "appliedMovePart": " from ${from} to ${to}",
      "failed": "Undo failed",
      "notCommitted": "Undo was not applied.",
      "rejected": "The other player declined the undo.",
      "rejectedTitle": "Undo declined",
      "request": {
        "body": "{name} wants to undo the last move. Do you agree?",
        "title": "Undo request"
      },
      "requestFailed": "Failed to send the undo request.",
      "wait": {
        "body": "The other player must approve undoing the previous move. Please wait."
      }
    },
    "errors": {
      "nick": {
        "required": "Nickname is required.",
        "tooShort": "Nickname is too short.",
        "tooLong": "Nickname is too long.",
        "invalid": "Invalid nickname."
      },
      "db": {
        "permission": "Insufficient permissions",
        "network": "Network issue",
        "timeout": "Connection timed out",
        "auth": "Authentication issue"
      }
    }

  },
  "fr": {
    "pages": {
      "cta": {
        "playNow": "Commencer à jouer"
      },
      "nav": {
        "rules": "Règles",
        "privacy": "Confidentialité",
        "terms": "Conditions d’utilisation",
        "contact": "Contact"
      },
      "navShort": {
        "privacy": "Confid.",
        "terms": "Conditions",
        "contact": "Contact"
      },
      "footer": {
        "text": "© ${year} El Ougl Software SARL — Tous droits réservés."
      },
      "mode": {
        "title": "Mode de jeu"
      }
    },
    "soufla": {
      "pick": {
        "toastNotOffender": "Cette pièce n’est pas fautive. Touchez la pièce qui a ignoré une prise.",
        "title": "Soufla sur votre adversaire. Touchez la pièce fautive, puis choisissez la sanction.",
        "btnRemove": "Supprimer",
        "btnForcePath": "Forcer le chemin ${n}"
      },
      "cpu": {
        "reason": "La pièce en ${offender}${startedFromPart} a ignoré la prise la plus longue (longueur ${len}).",
        "forcedPathLine": "${from} → ${path}",
        "penaltyRemove": "Sanction : <b>suppression</b> de votre pièce en ${cell}.",
        "revertNotice": "Votre dernier coup a été annulé (flèche jaune).",
        "title": "Soufla contre vous",
        "startedFromPart": " (départ : ${startedFrom})",
        "penaltyForceInline": "Sanction : <b>forçage</b> du chemin : ${from} → ${path}.",
        "forcedPathIntro": "Chemin imposé :",
        "penaltyForcePicked": "Sanction : <b>forçage</b>."
      },
      "applied": {
        "force": "La pièce de l’adversaire a été forcée à suivre le chemin le plus long.",
        "remove": "La pièce fautive de l’adversaire a été retirée.",
        "self": "Soufla appliquée."
      },
      "notCommitted": "Impossible d’appliquer la pénalité (ce n’est peut-être pas votre tour ou il y a eu un conflit).",
      "sendFailed": "Impossible d’appliquer la pénalité en ligne.",
      "summary": {
        "force": "Vous forcer à suivre le chemin de ${from} à ${to} de longueur ${len}, indiqué par la flèche verte.",
        "penaltyTitle": "Et l’adversaire a choisi la pénalité :",
        "reason": "Votre adversaire a réclamé Soufla contre vous car vous avez ignoré une capture valide, indiquée par la/les flèche(s) rouge(s) (la flèche rouge peut être masquée sous la flèche verte si l’option de forçage est choisie).",
        "remove": "Retrait de votre pièce fautive à ${cell}, marquée en rouge.",
        "title": "Soufla :",
        "undo": "Annulation de votre dernier coup de ${from} à ${to}, indiqué par la flèche jaune."
      }
    },
    "pvp": {
      "voice": {
        "micOn": "Couper le micro",
        "spkOn": "Couper le son",
        "failed": "Échec de connexion",
        "failedTitle": "Échec du chat vocal",
        "failure": {
          "permission": "Impossible d’accéder au microphone. Autorisez ce site à l’utiliser, puis réessayez.",
          "noDevice": "Aucun microphone disponible n’a été trouvé.",
          "busy": "Impossible d’ouvrir le microphone, car il est occupé ou indisponible.",
          "unsupported": "Le chat vocal n’est pas pris en charge par ce navigateur ou dans ce contexte.",
          "session": "Impossible de démarrer le chat vocal, car la session de la partie n’est pas prête. Rouvrez la partie puis réessayez.",
          "service": "Impossible de démarrer la connexion vocale pour le moment. Vérifiez votre connexion puis réessayez.",
          "generic": "Impossible de démarrer le chat vocal. Réessayez."
        },
        "micOff": "Activer le micro",
        "spkOff": "Activer le son",
        "mic": "Micro",
        "speaker": "Son"
      },
      "chat": {
        "open": "Chat",
        "empty": "Aucun message pour le moment.",
        "failed": "Échec de l’envoi. Réessayez.",
        "placeholder": "Écrivez un message…",
        "rateLimit": "Un message par seconde.",
        "send": "Envoyer",
        "title": "Chat",
        "tooLong": "200 caractères max."
      },
      "leave": "Quitter"
    },
    "advHelp": {
      "title": "Guide des niveaux",
      "levelsIntro": "Le jeu contre l’ordinateur utilise un moteur unique PVS/Alpha-Beta à approfondissement itératif et gestion automatique du temps. Les profondeurs indiquées sont des plafonds de sécurité; la recherche peut s’arrêter plus tôt selon le temps et la complexité. Les niveaux élevés disposent de plus de temps, de nœuds et de mémoire.",
      "levelsOnly": "Les niveaux contrôlent automatiquement le temps et les limites de recherche. Les niveaux élevés sont généralement plus forts mais plus lents; les niveaux faibles ne choisissent un coup légal proche du meilleur qu’après exclusion des pertes tactiques évidentes.",
      "levelDetails": {
        "beginner": "Plafond de profondeur : 7 ; temps de base : 180 ms ; limite stricte : 420 ms ; choix sûr parmi 4 coups proches au maximum.",
        "easy": "Plafond de profondeur : 10 ; temps de base : 500 ms ; limite stricte : 1,1 s ; choix sûr parmi 3 coups proches au maximum.",
        "medium": "Plafond de profondeur : 14 ; temps de base : 1,4 s ; limite stricte : 3 s ; meilleur coup de la dernière itération terminée ; niveau par défaut.",
        "hard": "Plafond de profondeur : 18 ; temps de base : 3,5 s ; limite stricte : 7 s ; meilleur coup de la dernière itération terminée.",
        "strong": "Plafond de profondeur : 22 ; temps de base : 7,5 s ; limite stricte : 15 s ; sélection à pleine puissance.",
        "expert": "Plafond de profondeur : 28 ; temps de base : 14 s ; limite stricte : 26 s ; limites maximales de recherche et de mémoire."
      }
    },
    "auth": {
      "msgPopupBlocked": "Impossible d’ouvrir la fenêtre Google. Autorisez les pop-ups.",
      "loginGoogleOption": "Se connecter avec Google",
      "guestNoLogin": "Continuer sans se connecter",
      "msgResetNotAllowed": "La réinitialisation du mot de passe n’est pas activée.",
      "msgSaved": "Modifications enregistrées.",
      "logoutFailed": "La déconnexion a échoué. Réessayez.",
      "brandFull": "Jeu de Dhamet mauritanien",
      "send": "Envoyer",
      "msgResetNoUser": "Aucun compte n’est associé à cet e-mail.",
      "password": "Mot de passe",
      "password2": "Confirmer le mot de passe",
      "msgResetDomain": "Ce domaine n’est pas autorisé. Vérifiez les paramètres Google OAuth et Cloudflare Worker.",
      "toRecover": "Mot de passe oublié ?",
      "save": "Enregistrer",
      "nickname": "Pseudo",
      "email": "Email",
      "registerTitle": "Créer un compte",
      "register": "S’inscrire",
      "recoverTitle": "Réinitialiser le mot de passe",
      "loginEmailOption": "Se connecter avec e-mail",
      "toRegister": "Créer un compte",
      "msgResetTooMany": "Trop de tentatives. Réessayez plus tard.",
      "backLogin": "Retour",
      "msgResetInvalidEmail": "Adresse e-mail invalide.",
      "msgInvalid": "Identifiants invalides.",
      "msgSent": "Instructions envoyées.",
      "msgNetwork": "Service indisponible.",
      "seo": {
        "start": {
          "title": "Commencez à jouer à Dhamet facilement",
          "b1": "Connectez-vous ou créez un nouveau compte, et vous pouvez aussi continuer comme invité pour essayer rapidement le jeu.",
          "b2": "Après la connexion, vous pouvez choisir de jouer contre l’ordinateur ou de jouer à Dhamet en ligne avec d’autres joueurs.",
          "b3": "La création d’un compte vous donne un profil personnel, des statistiques et une expérience plus complète dans l’application.",
          "b4": "Le mode invité convient à un essai rapide, tandis qu’un compte vous offre des fonctionnalités supplémentaires et une meilleure organisation de votre expérience.",
          "b5": "Au bas de la page, vous trouverez des liens vers les conditions d’utilisation, la politique de confidentialité, les règles et les moyens de contact.",
          "small": "Commencez de la manière qui vous convient, puis choisissez le mode de jeu qui vous correspond et profitez de l’expérience du jeu mauritanien Dhamet contre l’ordinateur ou en ligne."
        },
        "what": {
          "title": "Jeu mauritanien Dhamet | Dhamet",
          "b1": "Dhamet est un jeu mauritanien traditionnel fondé sur la réflexion, la planification et une bonne lecture du mouvement.",
          "b2": "Il se joue sur un plateau de points et de trajets, et se distingue des dames courantes par la forme du plateau, les directions de jeu et certaines règles fondamentales.",
          "b3": "Le jeu repose sur un bon placement, l’exploitation des occasions de prise et le bon moment pour promouvoir les pièces en Dhaïm.",
          "b4": "L’application Dhamet a été créée et développée par العُقل للبرمجيات / El Ougl Software SARL, titulaire des droits. Vous pouvez visiter le site de l’entreprise pour découvrir ses produits : <a href=\"https://ouglsoft.com\" target=\"_blank\" rel=\"noopener\">ouglsoft.com</a>.",
          "b5": "Vous pouvez découvrir les règles de Dhamet, puis commencer à jouer directement depuis le navigateur sur différents appareils.",
          "small": "Dhamet est un jeu stratégique mauritanien traditionnel fondé sur la réflexion, la planification et une bonne lecture du mouvement. L’application a été créée et développée par El Ougl Software SARL. Site de l’entreprise : <a href=\"https://ouglsoft.com\" target=\"_blank\" rel=\"noopener\">ouglsoft.com</a>."
        }
      }
    },
    "buttons": {
      "newGame": "Nouveau",
      "soufla": "Soufla",
      "settings": "Paramètres",
      "home": "Accueil",
      "resume": "Reprendre",
      "sync": "Actualiser",
      "save": "Enregistrer",
      "endKill": "Terminer la prise",
      "undo": "Annuler",
      "endMatch": "Quitter",
    },
    "dashboard": {
      "draws": "Nuls",
      "losses": "Défaites",
      "editEmail": "Changer l'e-mail",
      "title": "Tableau de bord",
      "points": "Points",
      "editPass": "Changer le mot de passe",
      "editNick": "Changer le nom",
      "wins": "Victoires",
      "vsComputer": "Contre l’ordinateur",
      "vsHumans": "Contre des humains",
      "totalGames": "Total des parties",
      "rank": "Classement",
      "matches": "Matchs",
      "total": "Total",
      "showLeaderboard": "Afficher le classement",
      "leaderboard": {
        "title": "Classement",
        "empty": "Aucune donnée pour le moment."
      },
      "editIcon": "Changer l'image",
      "nameLabel": "Nom",
      "deleteAccount": "Supprimer le compte",
      "logoutConfirm": {
        "title": "Déconnexion",
        "body": "Voulez-vous vous déconnecter ?"
      },
      "delete": {
        "title": "Supprimer le compte",
        "body": "Cette action supprimera votre compte et toutes les données associées. Saisissez votre mot de passe pour confirmer.",
        "passwordLabel": "Mot de passe",
        "confirm": "Supprimer",
        "success": "Votre compte a été supprimé.",
        "failed": "Impossible de supprimer toutes les données du compte. Veuillez réessayer.",
        "wrongPassword": "Mot de passe incorrect.",
        "recentLogin": "Veuillez vous reconnecter pour supprimer votre compte.",
        "googleNotSupported": "Les comptes Google ne peuvent pas être supprimés depuis l’application. Utilisez un compte e-mail/mot de passe."
      },
      "password": {
        "googleNotSupported": "Vous ne pouvez pas changer le mot de passe d’un compte Google.",
        "oldWrong": "Le mot de passe actuel est incorrect.",
        "weak": "Le nouveau mot de passe est trop faible.",
        "recentLogin": "Veuillez vous reconnecter pour changer votre mot de passe.",
        "currentLabel": "Mot de passe actuel",
        "newLabel": "Nouveau mot de passe"
      }
    },
    "settings": {
      "board2d": "2D",
      "pvpNotice": "Mode en ligne : le choix du joueur qui commence et les réglages de l’ordinateur sont désactivés.",
      "board3d": "3D",
      "aiCapture": "Règle de prise (ordinateur)",
      "aiIgnoreRate": "Taux d’ignorance de prise",
      "dark": "Sombre",
      "coords": "Afficher la numérotation",
      "boardStyle": "Style du plateau",
      "shortcuts": "Raccourcis : Entrée = Appliquer, Échap = Fermer",
      "random": "Aléatoire",
      "starter": "Joueur qui commence",
      "light": "Clair",
      "mandatory": "Obligatoire",
      "theme": "Thème",
      "starterNextGameNote": "Le choix du joueur qui commence ne s’applique qu’à la prochaine nouvelle partie.",
      "aiLevel": "Niveau",
      "aiLevelHint": "Règle automatiquement la force de l’ordinateur et son temps de réflexion.",
      "aiLevelWithValue": "Niveau : ${level}",
      "aiLevelNextMoveNote": "S’applique à partir du prochain coup de l’ordinateur.",
      "enabled": "Activé",
      "disabled": "Désactivé",
      "aiLevelChangeTitle": "Changer le niveau de l’ordinateur",
      "aiLevelChangeBody": "Changer le niveau influencera les paramètres internes de réflexion de l’ordinateur. Plus le niveau est difficile, plus l’ordinateur peut avoir besoin de temps pour réfléchir.",
      "levels": {
        "beginner": "Débutant",
        "easy": "Facile",
        "medium": "Moyen",
        "hard": "Difficile",
        "strong": "Fort",
        "expert": "Expert"
      },
      "showCoords": "Afficher les coordonnées",
      "aiIgnoreHint": "Utilisé seulement lorsque la capture de l’ordinateur est réglée sur aléatoire."
    },
    "modals": {
      "gameOver": {
        "title": "Résultat de la partie",
        "winner": "La partie est terminée. Le joueur {player} a gagné.",
        "draw": "La partie s’est terminée par un match nul.",
        "reason": {
          "noPieces": "Le joueur {player} n’avait plus de pièces.",
          "noLegalMoves": "Le joueur {player} n’avait plus de coup légal.",
          "oneKingEach": "Le match nul a été atteint avec un roi restant pour chaque joueur."
        }
      },
      "newGame": {
        "title": "Nouvelle partie",
        "confirm": "Démarrer une nouvelle partie et terminer la partie en cours ?"
      },
      "endMatch": {
        "confirm": "Voulez-vous terminer la partie ?"
      },
      "soufla": {
        "none": "Aucune soufla sur le dernier coup. Coup légal.",
        "header": "Soufla",
        "forcedOpeningWarning": "Pas de soufla pendant l’ouverture obligatoire."
      },
      "apply": "Appliquer",
      "yes": "Oui",
      "no": "Non",
      "forcedOpening": {
        "title": "Ouverture obligatoire",
        "body": "Ouverture obligatoire : 5 coups imposés par joueur, dans l’ordre. Le coup actuel est indiqué par la flèche rouge. Ensuite, jeu libre."
      },
      "notice": "Avis",
      "undo": {
        "notAllowedBody": "Vous ne pouvez pas annuler pendant l’ouverture obligatoire.",
        "notAllowedTitle": "Annulation impossible",
        "title": "Annuler"
      },
      "errorTitle": "Erreur",
      "pickOnlineNickTitle": "Choisissez un pseudo",
      "applySettings": {
        "title": "Appliquer les paramètres",
        "noChanges": "Aucun paramètre n’a été modifié.",
        "applying": "Application des paramètres...",
        "changedTitle": "Paramètres modifiés :",
        "applied": "Paramètres appliqués"
      },
      "successTitle": "Succès"
    },
    "log": {
      "gameStarted": "La partie a commencé.",
      "forced": {
        "openingStarted": "Ouverture obligatoire démarrée.",
        "openingEnded": "Ouverture obligatoire terminée."
      },
      "save": {
        "none": "Aucune partie enregistrée à reprendre.",
        "done": "État de la partie enregistré.",
        "confirm": "Voulez-vous terminer la partie en cours et reprendre une partie enregistrée précédemment ?",
        "resumed": "Partie reprise.",
        "error": "Impossible de reprendre la partie."
      },
      "results": {
        "savedOk": "Résultat ajouté à l’historique avec succès.",
        "savedFail": "Échec de l’ajout du résultat à l’historique.",
        "skipped": "Ajout du résultat au journal ignoré",
        "pvcCounted": "La partie a été ajoutée au classement (${points} points).",
        "pvcCountedCapped": "La partie a été enregistrée dans les statistiques, mais ce niveau a atteint sa limite de points.",
        "pvcRejected": {
          "restored_from_save": "La partie n’a pas été ajoutée car elle a été reprise depuis une sauvegarde.",
          "incomplete_record": "La partie n’a pas été ajoutée car son journal est incomplet.",
          "too_many_undos": "La partie n’a pas été ajoutée car la limite d’annulations a été dépassée.",
          "non_counted_ending": "La partie n’a pas été ajoutée car sa fin ne remplit pas les conditions de comptabilisation.",
          "already_recorded": "Le résultat de cette partie a déjà été enregistré.",
          "network_error": "Le résultat n’a pas pu être enregistré en raison d’un problème réseau.",
          "pending_retry": "La connexion est temporairement indisponible. Le résultat a été conservé sur cet appareil et sera renvoyé automatiquement.",
          "rate_limited": "La limite temporaire des résultats contre l’ordinateur a été atteinte. Réessayez plus tard.",
          "unknown": "La partie est terminée, mais elle n’a pas pu être ajoutée aux résultats."
        }
      },
      "promote": "Promotion : ${cell} est devenu roi (${side})",
      "promoteActor": "${actor} : a promu la pièce au point ${cell}.",
      "promoteSelf": "${actor} : avez promu la pièce au point ${cell}.",
      "soufla": {
        "force": "Soufla : forcer ${from} à suivre une chaîne (${path})",
        "remove": "Soufla : retirer ${cell}",
        "removePiece": "Soufla : la pièce ${piece} a été retirée au point ${cell}.",
        "forcePiece": "Soufla : la pièce ${piece} a été forcée à capturer de ${from} à ${to} (${n}).",
        "pressed": "Bouton Soufla activé",
        "pressedActor": "${actor} : a appuyé sur le bouton Soufla.",
        "pressedSelf": "${actor} : avez appuyé sur le bouton Soufla.",
        "removeActor": "${actor} : a retiré la pièce avec Soufla au point ${cell}.",
        "removeSelf": "${actor} : avez retiré la pièce avec Soufla au point ${cell}.",
        "forceActor": "${actor} : a forcé la pièce avec Soufla à capturer ${from}-${to} (${n}).",
        "forceSelf": "${actor} : avez forcé la pièce avec Soufla à capturer ${from}-${to} (${n})."
      },
      "pieceColorWhite": "blanche",
      "pieceColorBlack": "noire",
      "undoBySide": "${side} a annulé le coup.",
      "undoActor": "${actor} : a annulé le coup.",
      "undoSelf": "${actor} : avez annulé le coup.",
      "matchEndedByActor": "${actor} : a terminé la partie.",
      "matchEndedBySelf": "${actor} : avez terminé la partie.",
      "gameWinner": "La partie est terminée. Vainqueur : ${winner}.",
      "gameDraw": "La partie est terminée sans vainqueur.",
      "turnMoveFmt": "${side} : Déplacement ${from}-${to}.",
      "turnCaptureFmt": "${side} : Prise ${from}-${to} (${n})."
    },
    "mode": {
      "subtitle": "Jouez contre l’ordinateur, ou en ligne pour affronter d’autres joueurs ou regarder des parties en direct.",
      "pvcDesc": "Jouer contre l’ordinateur avec des niveaux de difficulté clairs.",
      "title": "Choisir le mode",
      "pvpTitle": "En ligne",
      "backToAccount": "Retour au compte",
      "pvpDesc": "Entrer dans le lobby et jouer avec d’autres.",
      "pvcTitle": "Contre l’ordinateur"
    },
    "lobby": {
      "backToMode": "Retour au choix du mode",
      "refresh": "Actualiser le lobby",
      "emptyRooms": "Aucune salle active.",
      "emptyPlayers": "Aucun joueur en ligne.",
      "loadingPlayers": "Chargement des joueurs en ligne...",
      "loadingRooms": "Chargement des parties en cours...",
      "loadFailed": "Le lobby est temporairement indisponible. Une nouvelle tentative sera effectuée automatiquement, ou appuyez sur Actualiser pour réessayer maintenant.",
      "rooms": "Liste des salles actives",
      "subtitle": "Choisissez une salle à regarder, ou invitez un joueur pour démarrer une partie.",
      "title": "Salles et joueurs en ligne",
      "inviteDisabled": "Invitation impossible pour le moment",
      "invitesDisabled": "Invitations désactivées",
      "noInvites": "N’accepte pas les invitations",
      "join": "Rejoindre",
      "returnToMatch": "Revenir à la partie",
      "yourActiveMatch": "Votre partie active",
      "reconnectingRoom": "Les joueurs se reconnectent",
      "privateRoom": "Salle privée",
      "roomDefault": "Salle",
      "roomLabel": "Salle",
      "spectate": "Observer",
      "spectatorFull": "Nombre de spectateurs complet pour cette salle."
    },
    "status": {
      "forcedChainStepByStep": "Prise en chaîne (ouverture) : prenez étape par étape.",
      "onlineInitFail": "Impossible d’initialiser le jeu en ligne pour le moment.",
      "reconnecting": "Rétablissement de la connexion…",
      "loadingMatch": "Chargement de la partie officielle…",
      "onlineInitHelp": "Veuillez vous connecter ou démarrer une session invité Cloudflare.",
      "loading": "Chargement…",
      "wait": "Attendez votre tour…",
      "aiThinkingMove": "L’ordinateur réfléchit…",
      "aiThinkingSoufla": "L’ordinateur choisit une pénalité de Soufla…",
      "aiThinkingMoveWaitLine": "Veuillez patienter… L’ordinateur réfléchit au coup approprié.",
      "currentLevel": "Niveau actuel",
      "aiThinkingMoveLevelDuration": "Niveau : ${level} (temps de réflexion de l’ordinateur de ${min} à ${max} secondes par coup)",
      "turn": "Au tour de :",
      "forcedChainIncomplete": "Terminez la chaîne de prises, puis appuyez sur « Terminer la prise ».",
      "forcedMove": "Ouverture obligatoire : le coup autorisé est ${from}→${to}",
      "moveSendFail": "Échec de l’envoi du coup. Veuillez le refaire.",
      "aiThinkingMoveLevelNote": "Remarque : plus le niveau est élevé, plus la réflexion peut durer."
    },
    "players": {
      "player": "Joueur",
      "you": "Vous",
      "white": "⚪ Blanc",
      "black": "⚫ Noir",
      "computer": "Ordinateur"
    },
    "aria": {
      "board": "Plateau de jeu",
      "activityLog": "Journal d’activité",
      "controls": "Commandes",
      "mobileStats": "Statistiques mobile",
      "pvpActions": "Actions PvP",
      "lobbyRooms": "Salles",
      "lobbyPlayers": "Joueurs",
      "dashboard": "Tableau de bord",
      "stats": "Statistiques",
      "matchDetails": "Détails du match",
      "editAccount": "Modifier le compte",
      "authOverview": "Vue d’ensemble de Dhamet",
      "authStart": "Commencer à jouer à Dhamet",
      "drawer": "Tiroir",
      "orientationToggle": "Changer l’orientation de l’affichage",
      "drawerToggle": "Ouvrir/Fermer le tiroir",
      "fullscreen": "Plein écran",
      "menu": "Menu",
      "primaryNav": "Navigation principale"
    },
    "ui": {
      "stats": "Statistiques",
      "noUndo": "Rien à annuler.",
      "undoOwnLastOnly": "Vous ne pouvez annuler le dernier coup que si vous l’avez joué.",
      "language": "Langue"
    },
    "meta_keywords": "zamat, zamet, jeu mauritanien, jeu de plateau, dames, jeu contre ordinateur, multijoueur en ligne",
    "online": {
      "permissionDenied": "Impossible d'effectuer l'action (autorisations Cloudflare insuffisantes).",
      "authRestoreFailed": "Impossible de restaurer la connexion du compte pour le moment. Veuillez vous reconnecter puis réessayer.",
      "connLimit": {
        "title": "Nombre maximal de connexions",
        "body": "Le nombre maximal de connexions autorisées (100) est atteint. Veuillez attendre qu’un des joueurs connectés parte, puis réessayez."
      },
      "presence": {
        "online": "En ligne",
        "disconnected": "Connexion coupée"
      },
      "endFail": "Impossible de terminer la partie pour le moment.",
      "endPresentation": {
        "winner": "La partie est terminée. Le joueur {player} a gagné.",
        "draw": "La partie s’est terminée par un match nul.",
        "endedBy": "Le joueur {player} a terminé la partie.",
        "endedByAbsence": "Le joueur {player} a demandé la fin de la partie après l’absence prolongée du joueur {opponent}.",
        "noRecordedResult": "Aucun résultat n’a été enregistré pour la partie.",
        "roomUnavailable": "La salle n’est plus disponible et le résultat de la partie n’a pas pu être récupéré.",
        "reason": {
          "noPieces": "Le joueur {player} n’avait plus de pièces.",
          "noLegalMoves": "Le joueur {player} n’avait plus de coup légal.",
          "oneKingEach": "Le match nul a été atteint avec un roi restant pour chaque joueur.",
          "positionDecisive": "La partie a été tranchée en faveur du gagnant parce que la position était décisive au moment de la fin."
        }
      },
      "errors": {
        "joinFailed": "Impossible de rejoindre la partie en ligne. Vérifiez les règles/autorisations de la base de données ou réessayez.",
        "noGame": "La partie est terminée ou la salle a été nettoyée.",
        "authRequired": "La session de connexion a expiré. Reconnectez-vous puis réessayez.",
        "presenceWriteDenied": "La connexion est revenue, mais votre présence dans la salle n’est pas encore restaurée. Resynchronisation en cours.",
        "moveWriteDenied": "Impossible d’envoyer le coup. Vérifiez que c’est votre tour et que la partie est encore active.",
        "inviteWriteDenied": "Impossible d’envoyer l’invitation. Le joueur a peut-être rejoint une partie ou votre session a expiré.",
        "chatWriteDenied": "Impossible d’envoyer le message. Vous devez être enregistré comme joueur ou spectateur dans cette salle.",
        "voiceWriteDenied": "Impossible de mettre à jour les données audio de cette partie.",
        "matchEnded": "Cette partie est terminée ; aucune nouvelle action ne peut être envoyée.",
        "spectatorAction": "Vous êtes spectateur dans cette salle et ne pouvez pas déplacer les pièces.",
        "spectatorJoinFailed": "Impossible de vous enregistrer comme spectateur dans cette salle. Réessayez."
      },
      "inviteInvalidated": "Cette action n’a pas pu être finalisée car l’autre joueur a rejoint une autre partie ou n’est plus connecté.",
      "inviteRejected": "L’invitation a été refusée.",
      "inviteSendFail": "Impossible d’envoyer l’invitation.",
      "log": {
        "inviteAccepted": "{player} a accepté l’invitation.",
        "inviteRejected": "{player} a refusé l’invitation.",
        "inviteSent": "{from} a envoyé une invitation à {to}."
      },
      "logFailed": "Échec de mise à jour du journal.",
      "pvpEndTitle": "Partie terminée",
      "resultNotCounted": {
        "early": "Aucun gagnant n’a été déclaré, car l’abandon ou l’absence a eu lieu avant la phase avancée.",
        "unclear": "Aucun gagnant n’a été déclaré, car la position n’était pas assez décisive.",
        "generic": "La partie s’est terminée sans gagnant officiel."
      },
      "newInviteBody": "Le joueur <strong>${fromName}</strong> vous invite à jouer${roomPart}.",
      "newInviteRoomPart": " dans la salle <strong>${roomName}</strong>",
      "newInviteTitle": "Nouvelle invitation",
      "noOpponent": "Impossible d’identifier l’adversaire.",
      "noPlayers": "Aucun joueur en ligne trouvé.",
      "offline": "Connexion Internet perdue… nouvelle tentative.",
      "absenceTitle": "Adversaire absent",
      "absencePrompt": "Le joueur {player} est hors ligne depuis deux minutes. Voulez-vous attendre ou terminer la partie ?",
      "opponent": "Adversaire",
      "player": "Joueur",
      "roomNamePlaceholder": "Nom de la salle",
      "roomNamePrompt": "Entrez un nom de salle pour la distinguer dans la liste.",
      "roomNameTitle": "Nommer la salle",
      "roomVisibility": {
        "public": "Salle publique (les spectateurs peuvent observer la partie)",
        "private": "Salle privée (les spectateurs ne peuvent pas observer la partie)"
      },
      "invites": {
        "receiveLabel": "Réception des invitations :",
        "enabled": "Activée",
        "disabled": "Désactivée",
        "enableReceiving": "Activer la réception des invitations",
        "receivingEnabled": "Réception des invitations activée.",
        "receivingDisabled": "Réception des invitations désactivée.",
        "notAccepting": "Ce joueur n’accepte pas les invitations pour le moment.",
        "inActiveMatch": "Vous êtes actuellement dans une partie en ligne active. Voulez-vous quitter la partie actuelle et envoyer l’invitation ?",
        "leaveActivePrompt": "Vous êtes actuellement dans une partie en ligne active. Voulez-vous quitter la partie actuelle et envoyer l’invitation ?",
        "leaveAndSend": "Quitter et envoyer",
        "returnToMatch": "Retour à la partie"
      },
      "syncFail": "Échec de synchronisation. Réessayez.",
      "syncIssueNotice": "Il est préférable d’actualiser la page. Un problème de synchronisation est détecté.",
      "waitingAcceptance": "L’invitation n’a pas encore été acceptée.",
      "status": {
        "available": "Disponible",
        "vsComputer": "Joue contre l’ordinateur",
        "inPvP": "Dans une partie en ligne",
        "spectating": "Observe une partie"
      },
      "disabledButton": "Cette action n’est pas disponible pour ce joueur pour le moment.",
      "playersLoadFail": "Impossible de charger la liste des joueurs en ligne.",
      "playersTitle": "Liste des joueurs connectés"
    },
    "stats": {
      "left": "Pièces restantes",
      "kings": "Rois",
      "captured": "Capturées"
    },
    "spectator": {
      "only": "Cette partie se joue entre deux autres joueurs. Vous êtes actuellement simple spectateur et vous n’êtes pas autorisé à déplacer les pièces."
    },
    "langs": {
      "en": "English",
      "ar": "العربية",
      "fr": "Français"
    },
    "chain": {
      "notice": {
        "body": "Pour terminer votre tour, appuyez sur « Terminer la prise / Minuteur ». En chaîne de prises, effectuez les prises étape par étape."
      }
    },
    "actions": {
      "ok": "OK",
      "accept": "Accepter",
      "continue": "Continuer",
      "invite": "Inviter",
      "reject": "Refuser",
      "wait": "Attendre",
      "cancel": "Annuler",
      "close": "Fermer",
      "back": "Retour"
    },
    "meta_description": "Une version web avancée du jeu mauritanien Zamat. Jouez contre l’ordinateur ou en ligne en arabe, anglais et français.",
    "topbar": {
      "logout": "Déconnexion",
      "account": "Compte",
      "dashboard": "Tableau de bord",
      "login": "Connexion"
    },
    "page_title": "Zamat mauritanien",
    "game": {
      "title": "Jeu de Dhamet mauritanien"
    },
    "schema_game_name": "Zamat mauritanien",
    "schema_game_genre": "Jeu de stratégie",
    "schema_game_type": "Game",
    "undo": {
      "applied": "Dernier coup annulé${movePart}.",
      "appliedMovePart": " de ${from} à ${to}",
      "failed": "Échec de l’annulation",
      "notCommitted": "Annulation non effectuée.",
      "rejected": "L’autre joueur a refusé l’annulation.",
      "rejectedTitle": "Annulation refusée",
      "request": {
        "body": "{name} veut annuler le dernier coup. Acceptez-vous ?",
        "title": "Demande d’annulation"
      },
      "requestFailed": "Impossible d’envoyer la demande d’annulation.",
      "wait": {
        "body": "L’autre joueur doit approuver l’annulation du coup précédent. Veuillez patienter."
      }
    },
    "errors": {
      "nick": {
        "required": "Le pseudo est requis.",
        "tooShort": "Le pseudo est trop court.",
        "tooLong": "Le pseudo est trop long.",
        "invalid": "Pseudo invalide."
      },
      "db": {
        "permission": "Autorisations insuffisantes",
        "network": "Problème de réseau",
        "timeout": "Délai de connexion dépassé",
        "auth": "Problème d’authentification"
      }
    }

  }
};
  window.translations = translations;

function deepGet(obj, key) {
    const segs = String(key || "").split(".");
    let cur = obj;
    for (const s of segs) {
      if (!cur || typeof cur !== "object") return undefined;
      cur = cur[s];
    }
    return cur;
  }

  function interpolate(str, vars) {
    if (!vars) return str;
    const repl = function (_, k) {
      const v = vars[k];
      return v === undefined || v === null ? "" : String(v);
    };
    let out = String(str).replace(/\$\{(\w+)\}/g, repl);
    out = out.replace(/\{(\w+)\}/g, repl);
    return out;
  }

  function tr(lang, key, vars) {
    const L = translations[lang] || translations.ar || {};
    const A = translations.ar || {};
    let out = deepGet(L, key);
    if (typeof out !== "string") out = deepGet(A, key);
    if (typeof out !== "string") out = String(key || "");
    return interpolate(out, vars);
  }

  function currentLang() {
    const l = (document.documentElement && document.documentElement.lang) || "";
    return translations[l] ? l : "ar";
  }

  window.t = function (key, vars) {
    return tr(currentLang(), key, vars);
  };

  window.tr = function (key, fallback, vars) {
    try {
      const v = window.t(key, vars);
      if (!v || v === key) return fallback != null ? fallback : v;
      return v;
    } catch (_) {
      return fallback != null ? fallback : String(key || "");
    }
  };

  function applyI18nDom(root, lang) {
    const scope = root || document;
    const useLang = translations[lang] ? lang : currentLang();
    const get = (key, vars) => tr(useLang, key, vars);

    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const k = el.getAttribute('data-i18n');
      const val = get(k);
      if (el.tagName === 'META') el.setAttribute('content', val);
      else el.textContent = val;
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const k = el.getAttribute('data-i18n-html');
      if (!k) return;
      el.innerHTML = get(k);
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const k = el.getAttribute('data-i18n-aria-label');
      if (k) el.setAttribute('aria-label', get(k));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const k = el.getAttribute('data-i18n-title');
      if (k) el.setAttribute('title', get(k));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const k = el.getAttribute('data-i18n-placeholder');
      if (k) el.setAttribute('placeholder', get(k));
    });
    scope.querySelectorAll('[data-i18n-alt]').forEach((el) => {
      const k = el.getAttribute('data-i18n-alt');
      if (k) el.setAttribute('alt', get(k));
    });

    try {
      document.documentElement.classList.remove('lang-ar', 'lang-en', 'lang-fr');
      document.documentElement.classList.add('lang-' + useLang);
      document.documentElement.setAttribute('lang', useLang);
      document.documentElement.setAttribute('dir', useLang === 'ar' ? 'rtl' : 'ltr');
    } catch (_) {}

    return useLang;
  }

  window.I18N = window.I18N || {};
  window.I18N.getLang = currentLang;
  window.I18N.translate = function (key, vars, fallback, lang) {
    try {
      const v = tr(translations[lang] ? lang : currentLang(), key, vars);
      if (!v || v === key) return fallback != null ? fallback : v;
      return v;
    } catch (_) {
      return fallback != null ? fallback : String(key || '');
    }
  };
  window.I18N.text = function (key, vars, lang) {
    try {
      return window.I18N.translate(key, vars, String(key || ''), lang);
    } catch (_) {
      return String(key || '');
    }
  };
  window.I18N.translateArgs = function (key, fallbackOrVars, varsMaybe, lang) {
    let fallback = null;
    let vars = null;
    if (fallbackOrVars && typeof fallbackOrVars === 'object' && !Array.isArray(fallbackOrVars)) {
      vars = fallbackOrVars;
    } else {
      fallback = fallbackOrVars;
      vars = varsMaybe;
    }
    return window.I18N.translate(key, vars, fallback, lang);
  };
  window.I18N.apply = function (root, lang) {
    return applyI18nDom(root || document, lang);
  };
  window.I18N.setLang = function (lang, root) {
    const useLang = translations[lang] ? lang : 'ar';
    try { document.documentElement.setAttribute('lang', useLang); } catch (_) {}
    return applyI18nDom(root || document, useLang);
  };

  function applyExtras() {
    const lang = currentLang();
    const langSel = document.getElementById("langSel");
    if (langSel && langSel.options) {
      for (const opt of langSel.options) {
        if (opt.value === "ar") opt.textContent = tr(lang, "langs.ar");
        else if (opt.value === "en") opt.textContent = tr(lang, "langs.en");
        else if (opt.value === "fr") opt.textContent = tr(lang, "langs.fr");
      }
    }

  }

  let scheduled = false;
  function applyDir() {
    const lang = currentLang();
    const dir = String(lang || "")
      .toLowerCase()
      .startsWith("ar")
      ? "rtl"
      : "ltr";
    const langShort = String(lang || "en")
      .toLowerCase()
      .startsWith("ar")
      ? "ar"
      : String(lang || "")
            .toLowerCase()
            .startsWith("fr")
        ? "fr"
        : "en";
    try {
      document.documentElement.setAttribute("lang", langShort);
    } catch (_) {}
    try {
      if (document.body) document.body.setAttribute("lang", langShort);
    } catch (_) {}

    try {
      document.documentElement.setAttribute("dir", dir);
    } catch (_) {}
    try {
      if (document.body) document.body.setAttribute("dir", dir);
    } catch (_) {}
    try {
      if (document.body) document.body.classList.toggle("lang-ar", dir === "rtl");
    } catch (_) {}
  }
  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(function () {
      scheduled = false;
      applyDir();

      /*
       * Keep DOM translations synchronized when i18n.js loads after the shell,
       * when the language is changed, or when caching changes script execution
       * order.
       */
      try {
        applyI18nDom(document, currentLang());
      } catch (_) {}

      applyExtras();
      try {
        if (window.LogMgr && typeof window.LogMgr.retranslate === "function")
          window.LogMgr.retranslate();
      } catch (_) {}
      try {
        if (window.Modal && typeof window.Modal.setDir === "function") window.Modal.setDir();
      } catch (_) {}
    }, 0);
  }

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        function () {
          scheduleApply();
        },
        { once: true },
      );
    } else {
      scheduleApply();
    }

    const mo1 = new MutationObserver(function () {
      scheduleApply();
    });
    mo1.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["lang"],
    });

    const mo2 = new MutationObserver(function () {
      scheduleApply();
    });
    if (document.body) {
      mo2.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        function () {
          if (document.body) mo2.observe(document.body, { childList: true, subtree: true });
        },
        { once: true },
      );
    }
  }

  init();
})();
