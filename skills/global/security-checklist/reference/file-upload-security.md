# File Upload Security - Detailed Examples

## Insecure vs Secure File Upload

Unrestricted file uploads can lead to remote code execution, storage exhaustion, and serving malicious content to users.

```typescript
import multer from 'multer'
import path from 'path'
import crypto from 'crypto'

// ❌ Insecure file upload
app.post('/upload', upload.single('file'), (req, res) => {
  // No validation! Attacker can upload .exe, .php, etc.
  res.json({ filename: req.file.filename })
})

// ✅ Secure file upload
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    // Generate random filename to prevent path traversal
    const randomName = crypto.randomBytes(16).toString('hex')
    const ext = path.extname(file.originalname)
    cb(null, `${randomName}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'))
    }
    cb(null, true)
  }
})

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  res.json({
    filename: req.file.filename,
    size: req.file.size,
    mimetype: req.file.mimetype
  })
})
```

## File Upload Checklist

- [ ] Validate file type (check MIME type AND file extension)
- [ ] Limit file size
- [ ] Generate random filenames
- [ ] Store files outside web root
- [ ] Scan for malware (if possible)
- [ ] Don't execute uploaded files
