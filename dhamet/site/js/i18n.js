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
      }
    },
    "soufla": {
      "pick": {
        "toastNotOffender": "هذه ليست القطعة المعلّمة بعلامة X الحمراء. اختر القطعة المخالفة الظاهرة على الرقعة.",
        "title": "لديك حق السوفلة. اختر القطعة التي تجاهلت الأسر والمعلّمة بعلامة X الحمراء، ثم اختر العقوبة.",
        "btnRemove": "إزالة القطعة",
        "btnForcePath": "إجبارها على المسار ${n}"
      },
      "cpu": {
        "reason": "تجاهلت قطعتك الأسر المحدد بالمسار الأحمر الظاهر على الرقعة.",
        "forcedPathLine": "اتبع المسار الملوّن الظاهر على الرقعة.",
        "penaltyRemove": "العقوبة: <b>إزالة القطعة المخالفة</b> من الموضع المعلّم بعلامة X حمراء.",
        "revertNotice": "أُلغيت نقلتك الأخيرة، ويظهر مسارها بالسهم الأصفر.",
        "title": "طُبقت السوفلة عليك",
        "penaltyForceInline": "العقوبة: <b>إجبار القطعة</b> على تنفيذ الأسر المحدد بالمسار الملوّن على الرقعة.",
        "forcedPathIntro": "مسار الأسر الذي ستنفذه القطعة:",
        "penaltyForcePicked": "العقوبة: <b>إجبار القطعة على الأسر</b>."
      },
      "applied": {
        "force": "أُجبرت قطعة الخصم على تنفيذ مسار الأسر الصحيح.",
        "remove": "أُزيلت قطعة الخصم التي تجاهلت الأسر.",
        "self": "تم تطبيق السوفلة."
      },
      "sendFailed": "تعذر تطبيق السوفلة بسبب مشكلة في الاتصال. تحقق من الإنترنت ثم حاول مرة أخرى.",
      "summary": {
        "force": "أُجبرت قطعتك على تنفيذ الأسر المحدد بالمسار الأخضر.",
        "penaltyTitle": "العقوبة المختارة:",
        "reason": "طالب خصمك بالسوفلة لأن قطعتك تجاهلت الأسر المحدد بالمسار الأحمر.",
        "remove": "أُزيلت قطعتك المخالفة من الموضع المعلّم بعلامة X حمراء.",
        "title": "نتيجة السوفلة",
        "undo": "أُلغيت نقلتك الأخيرة، ويظهر مسارها باللون الأصفر."
      }
    },
    "pvp": {
      "voice": {
        "micOn": "كتم الميكروفون",
        "spkOn": "كتم الصوت",
        "failed": "فشل الاتصال",
        "failedTitle": "تعذر تشغيل الصوت",
        "failure": {
          "permission": "اسمح للموقع باستخدام الميكروفون، ثم حاول مرة أخرى.",
          "noDevice": "لم يُعثر على ميكروفون متاح.",
          "busy": "الميكروفون مستخدم في تطبيق آخر أو غير متاح الآن.",
          "unsupported": "المحادثة الصوتية غير مدعومة في هذا المتصفح.",
          "session": "تعذر بدء الصوت في هذه المباراة. أعد فتح المباراة ثم حاول مرة أخرى.",
          "service": "تعذر بدء الصوت بسبب مشكلة في الاتصال. تحقق من الإنترنت ثم حاول مرة أخرى.",
          "generic": "تعذر تشغيل المحادثة الصوتية. حاول مرة أخرى."
        },
        "micOff": "فتح الميكروفون",
        "spkOff": "فتح الصوت",
        "mic": "الميكروفون",
        "speaker": "الصوت"
      },
      "chat": {
        "empty": "لا توجد رسائل حاليًا.",
        "failed": "تعذر إرسال الرسالة. حاول مرة أخرى.",
        "placeholder": "اكتب رسالة...",
        "rateLimit": "انتظر ثانية قبل إرسال رسالة أخرى.",
        "title": "الدردشة الكتابية",
        "tooLong": "اختصر الرسالة إلى 200 حرف أو أقل."
      },
      "leave": "مغادرة"
    },
    "advHelp": {
      "title": "شرح المستويات",
      "levelsIntro": "يعتمد اللعب ضد الحاسوب على محرك PVS/Alpha-Beta واحد ببحث تكراري وإدارة زمن تلقائية. حدود العمق المذكورة حدود أمان قصوى، وقد يتوقف البحث قبلها حسب الزمن وتعقيد الوضع. المستويات الأعلى تمنح المحرك وقتًا وعقدًا وذاكرة أكثر.",
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
      "msgResetNotAllowed": "استعادة كلمة المرور غير متاحة حاليًا. جرّب تسجيل الدخول بطريقة أخرى أو حاول لاحقًا.",
      "msgSaved": "تم حفظ التعديلات.",
      "logoutFailed": "تعذر تسجيل الخروج. حاول مرة أخرى.",
      "msgResetNoUser": "لا يوجد حساب مرتبط بهذا البريد.",
      "password": "كلمة المرور",
      "password2": "تأكيد كلمة المرور",
      "msgResetDomain": "تعذر إرسال رسالة استعادة كلمة المرور من هذا الموقع. جرّب لاحقًا أو تواصل مع الدعم.",
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
      "msgInvalid": "تحقق من البيانات المدخلة وأكمل الحقول المطلوبة.",
      "msgLoginInvalid": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
      "msgSent": "تم إرسال التعليمات إلى بريدك.",
      "msgNetwork": "تعذر الاتصال الآن. تحقق من الإنترنت ثم حاول مرة أخرى.",
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
      "endMatch": "خروج"
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
      "logoutConfirm": {
        "body": "هل تريد تسجيل الخروج من حسابك؟"
      },
      "delete": {
        "title": "حذف الحساب",
        "body": "سيتم حذف الحساب وجميع البيانات المرتبطة به. أدخل كلمة المرور للتأكيد.",
        "confirm": "حذف",
        "success": "تم حذف الحساب.",
        "wrongPassword": "كلمة المرور غير صحيحة.",
        "recentLogin": "تحتاج لإعادة تسجيل الدخول لحذف الحساب."
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
      "board3d": "ثلاثي الأبعاد",
      "dark": "داكن",
      "coords": "إظهار ترقيم النقاط",
      "boardStyle": "شكل الرقعة",
      "starter": "من يبدأ",
      "light": "فاتح",
      "theme": "الوضع البصري",
      "starterNextGameNote": "سيُطبَّق اختيار من يبدأ في اللعبة الجديدة فقط.",
      "aiLevel": "المستوى",
      "aiLevelHint": "يحدد قوة الحاسوب ووقت تفكيره تلقائيًا.",
      "aiLevelWithValue": "المستوى: ${level}",
      "aiLevelNextMoveNote": "سيُطبَّق ابتداءً من نقلة الحاسوب القادمة.",
      "enabled": "مفعّل",
      "disabled": "غير مفعّل",
      "levels": {
        "beginner": "مبتدئ",
        "easy": "سهل",
        "medium": "متوسط",
        "hard": "صعب",
        "strong": "قوي",
        "expert": "محترف"
      },
      "showCoords": "عرض الترقيم"
    },
    "modals": {
      "gameOver": {
        "title": "انتهت المباراة",
        "winner": "فاز اللاعب {player} بالمباراة.",
        "draw": "انتهت المباراة بالتعادل.",
        "reason": {
          "noPieces": "نفدت قطع اللاعب {player}.",
          "noLegalMoves": "لا يملك اللاعب {player} أي نقلة قانونية.",
          "oneKingEach": "تعادل اللاعبان بعد بقاء ظائم واحد لكل منهما."
        }
      },
      "newGame": {
        "title": "بدء مباراة جديدة",
        "confirm": "سيؤدي ذلك إلى إنهاء المباراة الحالية. هل تريد بدء مباراة جديدة؟"
      },
      "endMatch": {
        "confirm": "هل تريد إنهاء المباراة الحالية؟"
      },
      "soufla": {
        "none": "النقلة الأخيرة صحيحة، ولا توجد فيها سوفلة.",
        "header": "السوفلة",
        "forcedOpeningWarning": "السوفلة غير متاحة أثناء الافتتاح الإجباري."
      },
      "apply": "تطبيق",
      "yes": "نعم",
      "no": "لا",
      "forcedOpening": {
        "title": "الافتتاح الإجباري",
        "body": "تبدأ المباراة بخمس نقلات إجبارية لكل لاعب. اتبع السهم الأحمر لتنفيذ النقلة المطلوبة، ثم ينتقل اللعب إلى الوضع الحر."
      },
      "notice": "تنبيه",
      "undo": {
        "notAllowedBody": "لا يمكن التراجع قبل انتهاء الافتتاح الإجباري.",
        "notAllowedTitle": "التراجع غير متاح",
        "title": "التراجع عن نقلة"
      },
      "errorTitle": "تعذر تنفيذ الإجراء",
      "pickOnlineNickTitle": "اختر اسمًا للعب عبر الإنترنت",
      "applySettings": {
        "title": "حفظ الإعدادات",
        "noChanges": "لم تغيّر أي إعداد.",
        "changedTitle": "التغييرات:",
        "applied": "تم حفظ الإعدادات."
      },
      "successTitle": "تم بنجاح"
    },
    "log": {
      "gameStarted": "بدأت المباراة.",
      "forced": {
        "openingStarted": "بدأ الافتتاح الإجباري.",
        "openingEnded": "انتهى الافتتاح الإجباري."
      },
      "save": {
        "none": "لا توجد مباراة محفوظة لاستئنافها.",
        "done": "تم حفظ المباراة الحالية.",
        "confirm": "سيؤدي ذلك إلى إنهاء المباراة الحالية وفتح المباراة المحفوظة. هل تريد المتابعة؟",
        "resumed": "تم استئناف المباراة المحفوظة.",
        "error": "تعذر استئناف المباراة المحفوظة."
      },
      "results": {
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
        "pressed": "ضغط على زر سوفلة",
        "pressedActor": "${actor}: ضغط على زر سوفلة.",
        "pressedSelf": "${actor}: ضغطت على زر سوفلة.",
        "removeActor": "${actor}: أزال بالسوفلة القطعة عند النقطة ${cell}.",
        "removeSelf": "${actor}: أزلت بالسوفلة القطعة عند النقطة ${cell}.",
        "forceActor": "${actor}: أجبر بالسوفلة القطعة على الأسر ${from}-${to} (${n}).",
        "forceSelf": "${actor}: أجبرت بالسوفلة القطعة على الأسر ${from}-${to} (${n})."
      },
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
      "pvpDesc": "ابدأ مباراة مباشرة وتنافسية مع لاعب آخر متصل عبر الإنترنت.",
      "pvcTitle": "اللعب ضد الحاسوب"
    },
    "lobby": {
      "backToMode": "العودة إلى اختيار نمط اللعب",
      "refresh": "تحديث اللوبي",
      "emptyRooms": "لا توجد غرف جارية.",
      "emptyPlayers": "لا يوجد لاعبون متصلون.",
      "loadingPlayers": "جاري تحميل قائمة اللاعبين المتصلين...",
      "loadingRooms": "جاري تحميل قائمة الغرف النشطة...",
      "loadFailed": "تعذر تحميل اللوبي مؤقتًا. ستتم إعادة المحاولة تلقائيًا، ويمكنك الضغط على زر «تحديث» للمحاولة الآن.",
      "roomsTitle": "قائمة الغرف النشطة",
      "playersTitle": "قائمة اللاعبين المتصلين",
      "subtitle": "شاهد المباريات الجارية أو اختر لاعبًا متصلًا وادعه إلى مباراة مباشرة.",
      "title": "الغرف النشطة واللاعبون المتصلون",
      "inviteDisabled": "لا يمكن دعوته الآن",
      "invitesDisabled": "لا يقبل الدعوات",
      "returnToMatch": "العودة إلى المباراة",
      "reconnectingRoom": "اللاعبان يعيدان الاتصال",
      "privateRoom": "غرفة خاصة",
      "roomDefault": "غرفة",
      "roomLabel": "الغرفة",
      "spectate": "مشاهدة",
      "spectatorFull": "اكتمل عدد المشاهدين لهذه الغرفة."
    },
    "status": {
      "forcedChainStepByStep": "هذه سلسلة أسر إجبارية. نفّذها خطوةً خطوة.",
      "onlineInitFail": "تعذر فتح اللعب عبر الإنترنت الآن.",
      "reconnecting": "جارٍ استعادة الاتصال…",
      "loadingMatch": "جارٍ فتح المباراة…",
      "onlineInitHelp": "تحقق من تسجيل الدخول والاتصال، ثم أعد المحاولة.",
      "loading": "جارٍ التحميل…",
      "wait": "الدور على اللاعب الآخر. انتظر قليلًا.",
      "aiThinkingMove": "الحاسوب يختار نقلته…",
      "aiThinkingSoufla": "الحاسوب يختار عقوبة السوفلة…",
      "aiThinkingMoveWaitLine": "انتظر قليلًا بينما يختار الحاسوب النقلة المناسبة.",
      "currentLevel": "المستوى الحالي",
      "aiThinkingMoveLevelDuration": "المستوى: ${level} (مدة تفكير الحاسوب من ${min} إلى ${max} ثانية لكل نقلة)",
      "turn": "الدور الآن على:",
      "forcedChainIncomplete": "ما زال هناك أسر متاح. أكمل السلسلة ثم اضغط مؤقت إنهاء الأسر.",
      "forcedMove": "نقلة الافتتاح المطلوبة: من ${from} إلى ${to}",
      "moveSendFail": "تعذر إرسال النقلة. تحقق من الاتصال ثم أعد تنفيذها.",
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
      "stats": "الإحصاءات",
      "matchDetails": "تفاصيل المباراة",
      "editAccount": "تعديل الحساب",
      "authOverview": "نظرة عامة على ظامت",
      "authStart": "ابدأ لعب ظامت",
      "drawer": "الدرج",
      "orientationToggle": "تبديل اتجاه العرض",
      "drawerToggle": "تبديل الدرج",
      "menu": "القائمة",
      "primaryNav": "التنقل الرئيسي"
    },
    "ui": {
      "stats": "الإحصائيات",
      "noUndo": "لا توجد نقلة يمكن التراجع عنها.",
      "undoOwnLastOnly": "يمكنك التراجع فقط عن آخر نقلة نفذتها.",
      "language": "اللغة"
    },
    "meta_keywords": "ظامت, زامت, لعبة موريتانية, داما, لعب ضد الحاسوب, لعب عبر الإنترنت",
    "online": {
      "permissionDenied": "تعذر تنفيذ الإجراء. أعد تسجيل الدخول ثم حاول مرة أخرى.",
      "authRestoreFailed": "تعذر إبقاؤك مسجلًا للدخول. سجّل الدخول من جديد ثم حاول مرة أخرى.",
      "presence": {
        "online": "متصل",
        "disconnected": "انقطع الاتصال"
      },
      "endFail": "تعذر إنهاء المباراة الآن. تحقق من الاتصال ثم أعد المحاولة.",
      "endPresentation": {
        "winner": "انتهت المباراة. فاز اللاعب {player}.",
        "endedBy": "اللاعب {player} أنهى المباراة.",
        "endedByAbsence": "طلب اللاعب {player} إنهاء المباراة بعد استمرار غياب اللاعب {opponent}.",
        "noRecordedResult": "انتهت المباراة دون نتيجة محفوظة.",
        "roomUnavailable": "لم تعد الغرفة متاحة، لذلك تعذر عرض نتيجة المباراة.",
        "reason": {
          "noLegalMoves": "لم يعد اللاعب {player} يملك نقلة قانونية.",
          "oneKingEach": "تحقق التعادل ببقاء ظائم واحد لكل لاعب.",
          "positionDecisive": "اعتمدت النتيجة لأن اللاعب الفائز كان متقدمًا بوضوح عند إنهاء المباراة."
        }
      },
      "errors": {
        "noGame": "انتهت المباراة أو لم تعد الغرفة متاحة.",
        "authRequired": "تم تسجيل خروجك. سجّل الدخول من جديد ثم حاول مرة أخرى.",
        "presenceWriteDenied": "عاد الاتصال. جارٍ إعادتك إلى المباراة…",
        "moveWriteDenied": "لم تُرسل النقلة. تأكد أن الدور لك وأن المباراة ما زالت مستمرة، ثم حاول مرة أخرى.",
        "inviteWriteDenied": "لم تُرسل الدعوة. ربما بدأ اللاعب مباراة أخرى، أو تحتاج إلى تسجيل الدخول من جديد.",
        "chatWriteDenied": "لم تُرسل الرسالة لأنك لم تعد داخل هذه المباراة. أعد فتحها ثم حاول مرة أخرى.",
        "voiceWriteDenied": "تعذر تحديث الصوت. أوقف المحادثة الصوتية ثم شغّلها من جديد.",
        "matchEnded": "انتهت المباراة، ولا يمكن تنفيذ إجراء جديد.",
        "spectatorAction": "أنت تشاهد المباراة فقط، لذلك لا يمكنك تحريك القطع.",
        "spectatorJoinFailed": "تعذر الانضمام كمشاهد. حاول مرة أخرى."
      },
      "inviteInvalidated": "لم تعد الدعوة صالحة؛ ربما دخل اللاعب مباراة أخرى أو انقطع اتصاله.",
      "inviteSendFail": "تعذر إرسال الدعوة. حاول مرة أخرى.",
      "resultNotCounted": {
        "early": "لم يُحدَّد فائز لأن المباراة انتهت في وقت مبكر جدًا.",
        "unclear": "لم يُحدَّد فائز لأن وضع القطع عند الإنهاء لم يُظهر تفوقًا واضحًا.",
        "generic": "انتهت المباراة دون اعتماد فائز."
      },
      "newInviteBody": "يدعوك اللاعب <strong>${fromName}</strong> إلى مباراة${roomPart}.",
      "newInviteRoomPart": " في الغرفة <strong>${roomName}</strong>",
      "newInviteTitle": "دعوة إلى مباراة",
      "noPlayers": "لا يوجد لاعب متاح الآن.",
      "absenceTitle": "انقطع اتصال الخصم",
      "absencePrompt": "انقطع اتصال {player} منذ دقيقتين. هل تريد الانتظار أم إنهاء المباراة؟",
      "opponent": "الخصم",
      "roomNamePlaceholder": "اسم الغرفة",
      "roomNamePrompt": "اكتب اسمًا قصيرًا يميّز الغرفة في القائمة.",
      "roomNameTitle": "اسم الغرفة",
      "roomVisibility": {
        "public": "غرفة عامة (يسمح للمشاهدين بمتابعة المباراة)",
        "private": "غرفة خاصة (لا يسمح للمشاهدين بمتابعة المباراة)"
      },
      "invites": {
        "receiveLabel": "استقبال الدعوات:",
        "enabled": "مفعل",
        "disabled": "معطل",
        "receivingEnabled": "تم تفعيل استقبال الدعوات.",
        "receivingDisabled": "تم تعطيل استقبال الدعوات.",
        "notAccepting": "هذا اللاعب لا يستقبل الدعوات الآن.",
        "activeMatchTitle": "لديك مباراة جارية",
        "leaveActivePrompt": "لديك مباراة أونلاين جارية. هل تريد مغادرتها وإرسال الدعوة؟",
        "leaveAndSend": "مغادرة المباراة وإرسال الدعوة"
      },
      "status": {
        "available": "متاح",
        "vsComputer": "في مباراة ضد الحاسوب",
        "inPvP": "في مباراة أونلاين"
      },
      "syncFail": "تعذر تحديث المباراة. تحقق من الاتصال ثم حاول مرة أخرى.",
      "syncIssueNotice": "لم تظهر آخر تغييرات المباراة. اضغط «تحديث» لإعادة تحميلها.",
      "waitingAcceptance": "أُرسلت الدعوة، ولم يرد اللاعب بعد.",
      "playersLoadFail": "تعذر تحميل اللاعبين المتصلين. حاول تحديث اللوبي."
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
        "body": "نفّذ الأسر المتتابع خطوةً خطوة، ثم اضغط على مؤقت إنهاء الأسر لإكمال دورك."
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
      "back": "رجوع",
      "send": "إرسال"
    },
    "meta_description": "نسخة ويب متقدمة من لعبة ظامت الموريتانية، تدعم اللعب ضد الحاسوب أو عبر الإنترنت بثلاث لغات.",
    "topbar": {
      "login": "تسجيل الدخول",
      "logout": "تسجيل الخروج",
      "account": "الحساب"
    },
    "game": {
      "title": "لعبة ظامت الموريتانية"
    },
    "schema_game_genre": "لعبة استراتيجية",
    "schema_game_name": "ظامت الموريتانية",
    "schema_game_type": "Game",
    "undo": {
      "applied": "تم التراجع عن النقلة الأخيرة${movePart}.",
      "failed": "تعذر التراجع عن النقلة.",
      "notCommitted": "لم يتم التراجع لأن المباراة تقدمت قبل اكتمال الطلب. اضغط «تحديث» ثم حاول مرة أخرى.",
      "rejected": "رفض اللاعب الآخر طلب التراجع.",
      "rejectedTitle": "رُفض طلب التراجع",
      "request": {
        "body": "يريد {name} التراجع عن النقلة الأخيرة. هل توافق؟",
        "title": "طلب التراجع عن نقلة"
      },
      "requestFailed": "تعذر إرسال طلب التراجع. تحقق من الاتصال ثم أعد المحاولة.",
      "wait": {
        "body": "أُرسل طلب التراجع. انتظر رد اللاعب الآخر."
      }
    },
    "errors": {
      "nick": {
        "required": "الاسم المستعار مطلوب.",
        "tooShort": "الاسم المستعار قصير جدًا.",
        "tooLong": "الاسم المستعار طويل جدًا.",
        "invalid": "اسم مستعار غير صالح."
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
      }
    },
    "soufla": {
      "pick": {
        "toastNotOffender": "That piece is not marked with the red X. Select the offending piece shown on the board.",
        "title": "You may claim Soufla. Select the piece that skipped the capture and is marked with a red X, then choose the penalty.",
        "btnRemove": "Remove piece",
        "btnForcePath": "Force path ${n}"
      },
      "cpu": {
        "reason": "Your piece skipped the capture shown by the red path on the board.",
        "forcedPathLine": "Follow the highlighted path shown on the board.",
        "penaltyRemove": "Penalty: <b>remove the offending piece</b> from the position marked with a red X.",
        "revertNotice": "Your last move was undone and is shown by the yellow arrow.",
        "title": "Soufla was claimed against you",
        "penaltyForceInline": "Penalty: <b>force the piece</b> to complete the capture shown by the highlighted path.",
        "forcedPathIntro": "Capture path the piece must follow:",
        "penaltyForcePicked": "Penalty: <b>force the piece to capture</b>."
      },
      "applied": {
        "force": "The opponent’s piece was forced to follow the valid capture path.",
        "remove": "The opponent’s piece that skipped the capture was removed.",
        "self": "Soufla applied."
      },
      "sendFailed": "Soufla could not be applied because of a connection problem. Check your internet connection and try again.",
      "summary": {
        "force": "Your piece was forced to complete the capture shown by the green path.",
        "penaltyTitle": "Selected penalty:",
        "reason": "Your opponent claimed Soufla because your piece skipped the capture shown by the red path.",
        "remove": "Your offending piece was removed from the position marked with a red X.",
        "title": "Soufla result",
        "undo": "Your last move was undone and its path is shown in yellow."
      }
    },
    "pvp": {
      "voice": {
        "micOn": "Mute mic",
        "spkOn": "Mute",
        "failed": "Connection failed",
        "failedTitle": "Voice could not start",
        "failure": {
          "permission": "Allow microphone access for this site, then try again.",
          "noDevice": "No available microphone was found.",
          "busy": "The microphone is being used by another app or is unavailable.",
          "unsupported": "Voice chat is not supported by this browser.",
          "session": "Voice could not start in this match. Reopen the match and try again.",
          "service": "Voice could not start because of a connection problem. Check your internet connection and try again.",
          "generic": "Voice chat could not start. Try again."
        },
        "micOff": "Turn on microphone",
        "spkOff": "Turn on sound",
        "mic": "Mic",
        "speaker": "Sound"
      },
      "chat": {
        "empty": "No messages yet.",
        "failed": "The message could not be sent. Try again.",
        "placeholder": "Type a message…",
        "rateLimit": "Wait one second before sending another message.",
        "title": "Chat",
        "tooLong": "Shorten the message to 200 characters or fewer."
      },
      "leave": "Leave"
    },
    "advHelp": {
      "title": "Level guide",
      "levelsIntro": "Computer play uses one iterative-deepening PVS/Alpha-Beta engine with automatic time management. The listed depths are safety ceilings; search may stop earlier according to time and position complexity. Higher levels receive more time, nodes, and memory.",
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
      "msgResetNotAllowed": "Password recovery is not available right now. Use another sign-in method or try again later.",
      "msgSaved": "Changes saved.",
      "logoutFailed": "Sign-out failed. Please try again.",
      "msgResetNoUser": "No account found for this email.",
      "password": "Password",
      "password2": "Confirm password",
      "msgResetDomain": "A password-recovery message cannot be sent from this site right now. Try again later or contact support.",
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
      "msgInvalid": "Check the information you entered and complete the required fields.",
      "msgLoginInvalid": "The email address or password is incorrect.",
      "msgSent": "Instructions sent to your email.",
      "msgNetwork": "Unable to connect right now. Check your internet connection and try again.",
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
      "endMatch": "Exit"
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
      "logoutConfirm": {
        "body": "Sign out of your account?"
      },
      "delete": {
        "title": "Delete account",
        "body": "This will delete your account and all related data. Enter your password to confirm.",
        "confirm": "Delete",
        "success": "Your account has been deleted.",
        "wrongPassword": "Incorrect password.",
        "recentLogin": "Please sign in again to delete your account."
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
      "board3d": "3D",
      "dark": "Dark",
      "coords": "Show point numbering",
      "boardStyle": "Board style",
      "starter": "Starting player",
      "light": "Light",
      "theme": "Theme",
      "starterNextGameNote": "The starting player setting applies to the next new game only.",
      "aiLevel": "Level",
      "aiLevelHint": "Automatically controls computer strength and thinking time.",
      "aiLevelWithValue": "Level: ${level}",
      "aiLevelNextMoveNote": "Applies starting from the computer’s next move.",
      "enabled": "Enabled",
      "disabled": "Disabled",
      "levels": {
        "beginner": "Beginner",
        "easy": "Easy",
        "medium": "Medium",
        "hard": "Hard",
        "strong": "Strong",
        "expert": "Expert"
      },
      "showCoords": "Show coordinates"
    },
    "modals": {
      "gameOver": {
        "title": "Match over",
        "winner": "{player} won the match.",
        "draw": "The match ended in a draw.",
        "reason": {
          "noPieces": "{player} has no pieces left.",
          "noLegalMoves": "{player} has no legal move left.",
          "oneKingEach": "The match is a draw with one king left for each player."
        }
      },
      "newGame": {
        "title": "Start a new match",
        "confirm": "This will end the current match. Start a new one?"
      },
      "endMatch": {
        "confirm": "End the current match?"
      },
      "soufla": {
        "none": "The last move was valid. There is no Soufla.",
        "header": "Soufla",
        "forcedOpeningWarning": "Soufla is unavailable during the forced opening."
      },
      "apply": "Apply",
      "yes": "Yes",
      "no": "No",
      "forcedOpening": {
        "title": "Forced opening",
        "body": "The match begins with five forced moves for each player. Follow the red arrow for the required move; free play starts afterward."
      },
      "notice": "Notice",
      "undo": {
        "notAllowedBody": "You cannot undo until the forced opening is complete.",
        "notAllowedTitle": "Undo unavailable",
        "title": "Undo a move"
      },
      "errorTitle": "Action could not be completed",
      "pickOnlineNickTitle": "Choose an online name",
      "applySettings": {
        "title": "Save settings",
        "noChanges": "No settings were changed.",
        "changedTitle": "Changes:",
        "applied": "Settings saved."
      },
      "successTitle": "Done"
    },
    "log": {
      "gameStarted": "The match started.",
      "forced": {
        "openingStarted": "Forced opening started.",
        "openingEnded": "Forced opening ended."
      },
      "save": {
        "none": "There is no saved match to resume.",
        "done": "The current match was saved.",
        "confirm": "This will end the current match and open the saved one. Continue?",
        "resumed": "The saved match was resumed.",
        "error": "The saved match could not be resumed."
      },
      "results": {
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
        "pressed": "Pressed the Soufla button",
        "pressedActor": "${actor}: Pressed the Soufla button.",
        "pressedSelf": "${actor}: Pressed the Soufla button.",
        "removeActor": "${actor}: Removed the piece with Soufla at ${cell}.",
        "removeSelf": "${actor}: Removed the piece with Soufla at ${cell}.",
        "forceActor": "${actor}: Forced the piece with Soufla to capture ${from}-${to} (${n}).",
        "forceSelf": "${actor}: Forced the piece with Soufla to capture ${from}-${to} (${n})."
      },
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
      "subtitle": "Choose how you want to play: a solo match against the computer or a live match with another player.",
      "pvcDesc": "Start a solo match against an intelligent game engine and choose the difficulty that suits you.",
      "title": "Choose game mode",
      "pvpTitle": "Play Online",
      "backToAccount": "Back to account",
      "pvpDesc": "Start a live competitive match against another online player.",
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
      "roomsTitle": "Active rooms list",
      "playersTitle": "Connected players list",
      "subtitle": "Choose a room to watch, or invite a player to start a match.",
      "title": "Active rooms and connected players",
      "inviteDisabled": "Can't invite right now",
      "invitesDisabled": "Not accepting invites",
      "returnToMatch": "Return to match",
      "reconnectingRoom": "Players are reconnecting",
      "privateRoom": "Private room",
      "roomDefault": "Room",
      "roomLabel": "Room",
      "spectate": "Spectate",
      "spectatorFull": "Spectator slots are full for this room."
    },
    "status": {
      "forcedChainStepByStep": "This is a forced capture chain. Complete it one step at a time.",
      "onlineInitFail": "Online play could not be opened right now.",
      "reconnecting": "Restoring the connection…",
      "loadingMatch": "Opening the match…",
      "onlineInitHelp": "Check your sign-in and connection, then try again.",
      "loading": "Loading…",
      "wait": "It is the other player’s turn. Please wait.",
      "aiThinkingMove": "The computer is choosing a move…",
      "aiThinkingSoufla": "The computer is choosing a Soufla penalty…",
      "aiThinkingMoveWaitLine": "Please wait while the computer chooses its move.",
      "currentLevel": "Current level",
      "aiThinkingMoveLevelDuration": "Level: ${level} (computer thinking time from ${min} to ${max} seconds per move)",
      "turn": "Turn:",
      "forcedChainIncomplete": "Another capture is available. Finish the chain, then press the end-capture timer.",
      "forcedMove": "Required opening move: ${from} → ${to}",
      "moveSendFail": "The move could not be sent. Check your connection and play it again.",
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
      "stats": "Stats",
      "matchDetails": "Match details",
      "editAccount": "Edit account",
      "authOverview": "Dhamet overview",
      "authStart": "Start playing Dhamet",
      "drawer": "Drawer",
      "orientationToggle": "Toggle display orientation",
      "drawerToggle": "Toggle drawer",
      "menu": "Menu",
      "primaryNav": "Primary navigation"
    },
    "ui": {
      "stats": "Stats",
      "noUndo": "There is no move to undo.",
      "undoOwnLastOnly": "You can only undo the latest move that you made.",
      "language": "Language"
    },
    "meta_keywords": "zamat, zamet, mauritanian game, board game, checkers, draughts, computer play, online multiplayer",
    "online": {
      "permissionDenied": "The action could not be completed. Sign in again and retry.",
      "authRestoreFailed": "You were signed out. Sign in again and try once more.",
      "presence": {
        "online": "Online",
        "disconnected": "Disconnected"
      },
      "endFail": "The match could not be ended. Check your connection and try again.",
      "endPresentation": {
        "winner": "The match ended. Player {player} won.",
        "endedBy": "Player {player} ended the match.",
        "endedByAbsence": "Player {player} requested to end the match after player {opponent} remained absent.",
        "noRecordedResult": "The match ended without a saved result.",
        "roomUnavailable": "The room is no longer available, so the match result cannot be shown.",
        "reason": {
          "noLegalMoves": "Player {player} had no legal move left.",
          "oneKingEach": "The draw was reached with one king remaining for each player.",
          "positionDecisive": "The result was confirmed because the winner had a clear advantage when the match ended."
        }
      },
      "errors": {
        "noGame": "The match ended or the room is no longer available.",
        "authRequired": "You were signed out. Sign in again and try once more.",
        "presenceWriteDenied": "Connection restored. Returning you to the match…",
        "moveWriteDenied": "The move was not sent. Make sure it is your turn and the match is still active, then try again.",
        "inviteWriteDenied": "The invite was not sent. The player may have started another match, or you may need to sign in again.",
        "chatWriteDenied": "The message was not sent because you are no longer in this match. Reopen it and try again.",
        "voiceWriteDenied": "Voice could not be updated. Turn voice chat off and on, then try again.",
        "matchEnded": "The match has ended, so no new action can be taken.",
        "spectatorAction": "You are watching this match and cannot move the pieces.",
        "spectatorJoinFailed": "You could not join as a spectator. Try again."
      },
      "inviteInvalidated": "The invite is no longer valid. The player may have joined another match or gone offline.",
      "inviteSendFail": "The invite could not be sent. Try again.",
      "resultNotCounted": {
        "early": "No winner was declared because the match ended too early.",
        "unclear": "No winner was declared because the pieces did not show a clear advantage when the match ended.",
        "generic": "The match ended without an official winner."
      },
      "newInviteBody": "<strong>${fromName}</strong> invited you to a match${roomPart}.",
      "newInviteRoomPart": " in room <strong>${roomName}</strong>",
      "newInviteTitle": "Match invitation",
      "noPlayers": "No player is available right now.",
      "absenceTitle": "Opponent disconnected",
      "absencePrompt": "{player} has been offline for two minutes. Wait or end the match?",
      "opponent": "Opponent",
      "roomNamePlaceholder": "Room name",
      "roomNamePrompt": "Enter a short name that identifies this room in the list.",
      "roomNameTitle": "Room name",
      "roomVisibility": {
        "public": "Public room (spectators can watch the match)",
        "private": "Private room (spectators cannot watch the match)"
      },
      "invites": {
        "receiveLabel": "Invite receiving:",
        "enabled": "Enabled",
        "disabled": "Disabled",
        "receivingEnabled": "Invite receiving enabled.",
        "receivingDisabled": "Invite receiving disabled.",
        "notAccepting": "This player is not accepting invites right now.",
        "activeMatchTitle": "You have an active match",
        "leaveActivePrompt": "You already have an active online match. Leave it and send this invite?",
        "leaveAndSend": "Leave match and send invite"
      },
      "status": {
        "available": "Available",
        "vsComputer": "In a match vs computer",
        "inPvP": "In online match"
      },
      "syncFail": "The match could not be refreshed. Check your connection and try again.",
      "syncIssueNotice": "The latest match changes are not showing. Press Refresh to load them again.",
      "waitingAcceptance": "Invite sent. Waiting for the player’s response.",
      "playersLoadFail": "Online players could not be loaded. Refresh the lobby and try again."
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
        "body": "Complete the capture chain one step at a time, then press the end-capture timer to finish your turn."
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
      "back": "Back",
      "send": "Send"
    },
    "meta_description": "An advanced web version of the Mauritanian game Zamat. Play against the computer or online in Arabic, English, and French.",
    "topbar": {
      "logout": "Sign out",
      "account": "Account",
      "login": "Log in"
    },
    "game": {
      "title": "Mauritanian Dhamet game"
    },
    "schema_game_name": "Mauritanian Zamat",
    "schema_game_genre": "Strategy game",
    "schema_game_type": "Game",
    "undo": {
      "applied": "The last move was undone${movePart}.",
      "failed": "The move could not be undone.",
      "notCommitted": "The move was not undone because the match continued before the request finished. Press Refresh and try again.",
      "rejected": "The other player declined the undo request.",
      "rejectedTitle": "Undo request declined",
      "request": {
        "body": "{name} wants to undo the last move. Allow it?",
        "title": "Undo request"
      },
      "requestFailed": "The undo request could not be sent. Check your connection and try again.",
      "wait": {
        "body": "Undo request sent. Waiting for the other player’s response."
      }
    },
    "errors": {
      "nick": {
        "required": "Nickname is required.",
        "tooShort": "Nickname is too short.",
        "tooLong": "Nickname is too long.",
        "invalid": "Invalid nickname."
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
      }
    },
    "soufla": {
      "pick": {
        "toastNotOffender": "Cette pièce n’est pas marquée d’une croix rouge. Sélectionnez la pièce fautive affichée sur le plateau.",
        "title": "Vous pouvez réclamer Soufla. Sélectionnez la pièce qui a ignoré la prise et qui est marquée d’une croix rouge, puis choisissez la sanction.",
        "btnRemove": "Retirer la pièce",
        "btnForcePath": "Imposer le chemin ${n}"
      },
      "cpu": {
        "reason": "Votre pièce a ignoré la prise indiquée par le chemin rouge sur le plateau.",
        "forcedPathLine": "Suivez le chemin coloré affiché sur le plateau.",
        "penaltyRemove": "Sanction : <b>retirer la pièce fautive</b> de la position marquée d’une croix rouge.",
        "revertNotice": "Votre dernier coup a été annulé et apparaît avec la flèche jaune.",
        "title": "Soufla réclamée contre vous",
        "penaltyForceInline": "Sanction : <b>forcer la pièce</b> à effectuer la prise indiquée par le chemin coloré.",
        "forcedPathIntro": "Chemin de prise que la pièce doit suivre :",
        "penaltyForcePicked": "Sanction : <b>forcer la pièce à prendre</b>."
      },
      "applied": {
        "force": "La pièce adverse a été forcée à suivre le chemin de prise valide.",
        "remove": "La pièce adverse qui a ignoré la prise a été retirée.",
        "self": "Soufla appliquée."
      },
      "sendFailed": "La Soufla n’a pas pu être appliquée à cause d’un problème de connexion. Vérifiez votre accès à Internet puis réessayez.",
      "summary": {
        "force": "Votre pièce a été forcée à effectuer la prise indiquée par le chemin vert.",
        "penaltyTitle": "Sanction choisie :",
        "reason": "Votre adversaire a réclamé Soufla parce que votre pièce a ignoré la prise indiquée par le chemin rouge.",
        "remove": "Votre pièce fautive a été retirée de la position marquée d’une croix rouge.",
        "title": "Résultat de la Soufla",
        "undo": "Votre dernier coup a été annulé et son chemin apparaît en jaune."
      }
    },
    "pvp": {
      "voice": {
        "micOn": "Couper le micro",
        "spkOn": "Couper le son",
        "failed": "Échec de connexion",
        "failedTitle": "Impossible de démarrer l’audio",
        "failure": {
          "permission": "Autorisez ce site à utiliser le microphone, puis réessayez.",
          "noDevice": "Aucun microphone disponible n’a été trouvé.",
          "busy": "Le microphone est utilisé par une autre application ou indisponible.",
          "unsupported": "Le chat vocal n’est pas pris en charge par ce navigateur.",
          "session": "L’audio n’a pas pu démarrer dans cette partie. Rouvrez la partie puis réessayez.",
          "service": "L’audio n’a pas pu démarrer à cause d’un problème de connexion. Vérifiez votre accès à Internet puis réessayez.",
          "generic": "Le chat vocal n’a pas pu démarrer. Réessayez."
        },
        "micOff": "Activer le micro",
        "spkOff": "Activer le son",
        "mic": "Micro",
        "speaker": "Son"
      },
      "chat": {
        "empty": "Aucun message pour le moment.",
        "failed": "Le message n’a pas pu être envoyé. Réessayez.",
        "placeholder": "Écrivez un message…",
        "rateLimit": "Attendez une seconde avant d’envoyer un autre message.",
        "title": "Chat",
        "tooLong": "Réduisez le message à 200 caractères ou moins."
      },
      "leave": "Quitter"
    },
    "advHelp": {
      "title": "Guide des niveaux",
      "levelsIntro": "Le jeu contre l’ordinateur utilise un moteur unique PVS/Alpha-Beta à approfondissement itératif et gestion automatique du temps. Les profondeurs indiquées sont des plafonds de sécurité; la recherche peut s’arrêter plus tôt selon le temps et la complexité. Les niveaux élevés disposent de plus de temps, de nœuds et de mémoire.",
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
      "msgResetNotAllowed": "La récupération du mot de passe n’est pas disponible pour le moment. Utilisez une autre méthode de connexion ou réessayez plus tard.",
      "msgSaved": "Modifications enregistrées.",
      "logoutFailed": "La déconnexion a échoué. Réessayez.",
      "msgResetNoUser": "Aucun compte n’est associé à cet e-mail.",
      "password": "Mot de passe",
      "password2": "Confirmer le mot de passe",
      "msgResetDomain": "Le message de récupération du mot de passe ne peut pas être envoyé depuis ce site pour le moment. Réessayez plus tard ou contactez l’assistance.",
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
      "msgInvalid": "Vérifiez les informations saisies et remplissez les champs obligatoires.",
      "msgLoginInvalid": "L’adresse e-mail ou le mot de passe est incorrect.",
      "msgSent": "Instructions envoyées.",
      "msgNetwork": "Connexion impossible pour le moment. Vérifiez votre accès à Internet puis réessayez.",
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
      "endMatch": "Quitter"
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
      "logoutConfirm": {
        "body": "Voulez-vous vous déconnecter de votre compte ?"
      },
      "delete": {
        "title": "Supprimer le compte",
        "body": "Cette action supprimera votre compte et toutes les données associées. Saisissez votre mot de passe pour confirmer.",
        "confirm": "Supprimer",
        "success": "Votre compte a été supprimé.",
        "wrongPassword": "Mot de passe incorrect.",
        "recentLogin": "Veuillez vous reconnecter pour supprimer votre compte."
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
      "board3d": "3D",
      "dark": "Sombre",
      "coords": "Afficher la numérotation",
      "boardStyle": "Style du plateau",
      "starter": "Joueur qui commence",
      "light": "Clair",
      "theme": "Thème",
      "starterNextGameNote": "Le choix du joueur qui commence ne s’applique qu’à la prochaine nouvelle partie.",
      "aiLevel": "Niveau",
      "aiLevelHint": "Règle automatiquement la force de l’ordinateur et son temps de réflexion.",
      "aiLevelWithValue": "Niveau : ${level}",
      "aiLevelNextMoveNote": "S’applique à partir du prochain coup de l’ordinateur.",
      "enabled": "Activé",
      "disabled": "Désactivé",
      "levels": {
        "beginner": "Débutant",
        "easy": "Facile",
        "medium": "Moyen",
        "hard": "Difficile",
        "strong": "Fort",
        "expert": "Expert"
      },
      "showCoords": "Afficher les coordonnées"
    },
    "modals": {
      "gameOver": {
        "title": "Partie terminée",
        "winner": "{player} a gagné la partie.",
        "draw": "La partie s’est terminée par un match nul.",
        "reason": {
          "noPieces": "{player} n’a plus de pièces.",
          "noLegalMoves": "{player} n’a plus de coup légal.",
          "oneKingEach": "La partie est nulle avec un roi restant pour chaque joueur."
        }
      },
      "newGame": {
        "title": "Démarrer une nouvelle partie",
        "confirm": "La partie en cours sera terminée. Voulez-vous en démarrer une nouvelle ?"
      },
      "endMatch": {
        "confirm": "Voulez-vous terminer la partie en cours ?"
      },
      "soufla": {
        "none": "Le dernier coup est valide. Il n’y a pas de Soufla.",
        "header": "Soufla",
        "forcedOpeningWarning": "La Soufla n’est pas disponible pendant l’ouverture obligatoire."
      },
      "apply": "Appliquer",
      "yes": "Oui",
      "no": "Non",
      "forcedOpening": {
        "title": "Ouverture obligatoire",
        "body": "La partie commence par cinq coups obligatoires pour chaque joueur. Suivez la flèche rouge pour jouer le coup demandé ; le jeu devient ensuite libre."
      },
      "notice": "Information",
      "undo": {
        "notAllowedBody": "Vous ne pouvez pas annuler avant la fin de l’ouverture obligatoire.",
        "notAllowedTitle": "Annulation indisponible",
        "title": "Annuler un coup"
      },
      "errorTitle": "Action impossible",
      "pickOnlineNickTitle": "Choisissez un nom en ligne",
      "applySettings": {
        "title": "Enregistrer les paramètres",
        "noChanges": "Aucun paramètre n’a été modifié.",
        "changedTitle": "Modifications :",
        "applied": "Paramètres enregistrés."
      },
      "successTitle": "Terminé"
    },
    "log": {
      "gameStarted": "La partie a commencé.",
      "forced": {
        "openingStarted": "Ouverture obligatoire démarrée.",
        "openingEnded": "Ouverture obligatoire terminée."
      },
      "save": {
        "none": "Aucune partie enregistrée ne peut être reprise.",
        "done": "La partie en cours a été enregistrée.",
        "confirm": "La partie en cours sera terminée et la partie enregistrée sera ouverte. Continuer ?",
        "resumed": "La partie enregistrée a été reprise.",
        "error": "La partie enregistrée n’a pas pu être reprise."
      },
      "results": {
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
        "pressed": "Bouton Soufla activé",
        "pressedActor": "${actor} : a appuyé sur le bouton Soufla.",
        "pressedSelf": "${actor} : avez appuyé sur le bouton Soufla.",
        "removeActor": "${actor} : a retiré la pièce avec Soufla au point ${cell}.",
        "removeSelf": "${actor} : avez retiré la pièce avec Soufla au point ${cell}.",
        "forceActor": "${actor} : a forcé la pièce avec Soufla à capturer ${from}-${to} (${n}).",
        "forceSelf": "${actor} : avez forcé la pièce avec Soufla à capturer ${from}-${to} (${n})."
      },
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
      "subtitle": "Choisissez votre façon de jouer : une partie en solo contre l’ordinateur ou une partie en direct avec un autre joueur.",
      "pvcDesc": "Commencez une partie en solo contre un moteur de jeu intelligent et choisissez le niveau de difficulté adapté.",
      "title": "Choisir le mode",
      "pvpTitle": "En ligne",
      "backToAccount": "Retour au compte",
      "pvpDesc": "Commencez une partie directe et compétitive contre un autre joueur connecté.",
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
      "roomsTitle": "Liste des salles actives",
      "playersTitle": "Liste des joueurs connectés",
      "subtitle": "Choisissez une salle à regarder, ou invitez un joueur pour démarrer une partie.",
      "title": "Salles actives et joueurs connectés",
      "inviteDisabled": "Invitation impossible pour le moment",
      "invitesDisabled": "N’accepte pas les invitations",
      "returnToMatch": "Revenir à la partie",
      "reconnectingRoom": "Les joueurs se reconnectent",
      "privateRoom": "Salle privée",
      "roomDefault": "Salle",
      "roomLabel": "Salle",
      "spectate": "Observer",
      "spectatorFull": "Nombre de spectateurs complet pour cette salle."
    },
    "status": {
      "forcedChainStepByStep": "Cette chaîne de prises est obligatoire. Effectuez-la étape par étape.",
      "onlineInitFail": "Le jeu en ligne ne peut pas être ouvert pour le moment.",
      "reconnecting": "Rétablissement de la connexion…",
      "loadingMatch": "Ouverture de la partie…",
      "onlineInitHelp": "Vérifiez que vous êtes connecté et que votre accès à Internet fonctionne, puis réessayez.",
      "loading": "Chargement…",
      "wait": "C’est au tour de l’autre joueur. Veuillez patienter.",
      "aiThinkingMove": "L’ordinateur choisit son coup…",
      "aiThinkingSoufla": "L’ordinateur choisit la sanction de Soufla…",
      "aiThinkingMoveWaitLine": "Veuillez patienter pendant que l’ordinateur choisit son coup.",
      "currentLevel": "Niveau actuel",
      "aiThinkingMoveLevelDuration": "Niveau : ${level} (temps de réflexion de l’ordinateur de ${min} à ${max} secondes par coup)",
      "turn": "Au tour de :",
      "forcedChainIncomplete": "Une autre prise est disponible. Terminez la chaîne, puis appuyez sur le minuteur de fin de prise.",
      "forcedMove": "Coup d’ouverture requis : ${from} → ${to}",
      "moveSendFail": "Le coup n’a pas pu être envoyé. Vérifiez votre connexion et rejouez-le.",
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
      "stats": "Statistiques",
      "matchDetails": "Détails du match",
      "editAccount": "Modifier le compte",
      "authOverview": "Vue d’ensemble de Dhamet",
      "authStart": "Commencer à jouer à Dhamet",
      "drawer": "Tiroir",
      "orientationToggle": "Changer l’orientation de l’affichage",
      "drawerToggle": "Ouvrir/Fermer le tiroir",
      "menu": "Menu",
      "primaryNav": "Navigation principale"
    },
    "ui": {
      "stats": "Statistiques",
      "noUndo": "Aucun coup ne peut être annulé.",
      "undoOwnLastOnly": "Vous pouvez uniquement annuler le dernier coup que vous avez joué.",
      "language": "Langue"
    },
    "meta_keywords": "zamat, zamet, jeu mauritanien, jeu de plateau, dames, jeu contre ordinateur, multijoueur en ligne",
    "online": {
      "permissionDenied": "L’action n’a pas pu être effectuée. Reconnectez-vous puis réessayez.",
      "authRestoreFailed": "Vous avez été déconnecté. Reconnectez-vous puis réessayez.",
      "presence": {
        "online": "En ligne",
        "disconnected": "Connexion coupée"
      },
      "endFail": "La partie n’a pas pu être terminée. Vérifiez votre connexion et réessayez.",
      "endPresentation": {
        "winner": "La partie est terminée. Le joueur {player} a gagné.",
        "endedBy": "Le joueur {player} a terminé la partie.",
        "endedByAbsence": "Le joueur {player} a demandé la fin de la partie après l’absence prolongée du joueur {opponent}.",
        "noRecordedResult": "La partie s’est terminée sans résultat enregistré.",
        "roomUnavailable": "La salle n’est plus disponible ; le résultat de la partie ne peut donc pas être affiché.",
        "reason": {
          "noLegalMoves": "Le joueur {player} n’avait plus de coup légal.",
          "oneKingEach": "Le match nul a été atteint avec un roi restant pour chaque joueur.",
          "positionDecisive": "Le résultat a été confirmé, car le gagnant avait un avantage clair à la fin de la partie."
        }
      },
      "errors": {
        "noGame": "La partie est terminée ou la salle n’est plus disponible.",
        "authRequired": "Vous avez été déconnecté. Reconnectez-vous puis réessayez.",
        "presenceWriteDenied": "Connexion rétablie. Retour à la partie en cours…",
        "moveWriteDenied": "Le coup n’a pas été envoyé. Vérifiez que c’est votre tour et que la partie est toujours en cours, puis réessayez.",
        "inviteWriteDenied": "L’invitation n’a pas été envoyée. Le joueur a peut-être commencé une autre partie, ou vous devez peut-être vous reconnecter.",
        "chatWriteDenied": "Le message n’a pas été envoyé, car vous n’êtes plus dans cette partie. Rouvrez-la puis réessayez.",
        "voiceWriteDenied": "L’audio n’a pas pu être mis à jour. Désactivez puis réactivez le chat vocal et réessayez.",
        "matchEnded": "La partie est terminée ; aucune nouvelle action ne peut être effectuée.",
        "spectatorAction": "Vous regardez cette partie et ne pouvez pas déplacer les pièces.",
        "spectatorJoinFailed": "Impossible de rejoindre comme spectateur. Réessayez."
      },
      "inviteInvalidated": "L’invitation n’est plus valable. Le joueur a peut-être rejoint une autre partie ou s’est déconnecté.",
      "inviteSendFail": "L’invitation n’a pas pu être envoyée. Réessayez.",
      "resultNotCounted": {
        "early": "Aucun gagnant n’a été déclaré, car la partie s’est terminée trop tôt.",
        "unclear": "Aucun gagnant n’a été déclaré, car la position des pièces ne montrait pas d’avantage clair à la fin.",
        "generic": "La partie s’est terminée sans gagnant officiel."
      },
      "newInviteBody": "<strong>${fromName}</strong> vous invite à une partie${roomPart}.",
      "newInviteRoomPart": " dans la salle <strong>${roomName}</strong>",
      "newInviteTitle": "Invitation à une partie",
      "noPlayers": "Aucun joueur n’est disponible pour le moment.",
      "absenceTitle": "Adversaire déconnecté",
      "absencePrompt": "{player} est hors ligne depuis deux minutes. Attendre ou terminer la partie ?",
      "opponent": "Adversaire",
      "roomNamePlaceholder": "Nom de la salle",
      "roomNamePrompt": "Saisissez un nom court pour identifier cette salle dans la liste.",
      "roomNameTitle": "Nom de la salle",
      "roomVisibility": {
        "public": "Salle publique (les spectateurs peuvent observer la partie)",
        "private": "Salle privée (les spectateurs ne peuvent pas observer la partie)"
      },
      "invites": {
        "receiveLabel": "Réception des invitations :",
        "enabled": "Activée",
        "disabled": "Désactivée",
        "receivingEnabled": "Réception des invitations activée.",
        "receivingDisabled": "Réception des invitations désactivée.",
        "notAccepting": "Ce joueur n’accepte pas les invitations pour le moment.",
        "activeMatchTitle": "Vous avez une partie en cours",
        "leaveActivePrompt": "Vous avez déjà une partie en ligne active. La quitter et envoyer cette invitation ?",
        "leaveAndSend": "Quitter et envoyer l’invitation"
      },
      "syncFail": "La partie n’a pas pu être actualisée. Vérifiez votre connexion puis réessayez.",
      "syncIssueNotice": "Les derniers changements de la partie ne sont pas affichés. Appuyez sur Actualiser pour les recharger.",
      "waitingAcceptance": "Invitation envoyée. En attente de la réponse du joueur.",
      "status": {
        "available": "Disponible",
        "vsComputer": "Dans une partie contre l’ordinateur",
        "inPvP": "Dans une partie en ligne"
      },
      "playersLoadFail": "Impossible de charger les joueurs connectés. Actualisez le lobby et réessayez."
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
        "body": "Effectuez la chaîne de prises étape par étape, puis appuyez sur le minuteur de fin de prise pour terminer votre tour."
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
      "back": "Retour",
      "send": "Envoyer"
    },
    "meta_description": "Une version web avancée du jeu mauritanien Zamat. Jouez contre l’ordinateur ou en ligne en arabe, anglais et français.",
    "topbar": {
      "logout": "Déconnexion",
      "account": "Compte",
      "login": "Connexion"
    },
    "game": {
      "title": "Jeu de Dhamet mauritanien"
    },
    "schema_game_name": "Zamat mauritanien",
    "schema_game_genre": "Jeu de stratégie",
    "schema_game_type": "Game",
    "undo": {
      "applied": "Le dernier coup a été annulé${movePart}.",
      "failed": "Le coup n’a pas pu être annulé.",
      "notCommitted": "Le coup n’a pas été annulé, car la partie a continué avant la fin de la demande. Appuyez sur Actualiser puis réessayez.",
      "rejected": "L’autre joueur a refusé la demande d’annulation.",
      "rejectedTitle": "Demande d’annulation refusée",
      "request": {
        "body": "{name} souhaite annuler le dernier coup. Acceptez-vous ?",
        "title": "Demande d’annulation"
      },
      "requestFailed": "La demande d’annulation n’a pas pu être envoyée. Vérifiez votre connexion et réessayez.",
      "wait": {
        "body": "Demande envoyée. En attente de la réponse de l’autre joueur."
      }
    },
    "errors": {
      "nick": {
        "required": "Le pseudo est requis.",
        "tooShort": "Le pseudo est trop court.",
        "tooLong": "Le pseudo est trop long.",
        "invalid": "Pseudo invalide."
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
