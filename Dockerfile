# صورة تشغيل للتطبيق (تعمل على Railway وأي منصة تدعم Docker).
# لا اعتماديات خارجية — لا حاجة لـ npm install.
FROM node:22-slim

WORKDIR /app

# انسخ الكود كاملاً (المواقع + البوابة + الخادم)
COPY package.json ./
COPY server.js ./
COPY site ./site
COPY portal ./portal

ENV NODE_ENV=production

# مسار قاعدة البيانات داخل المجلد الدائم (اربطه كـ Volume /data في المنصة)
ENV DB_PATH=/data/alwathaq.db

EXPOSE 8123

CMD ["node", "server.js"]