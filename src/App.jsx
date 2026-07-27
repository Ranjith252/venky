import { useEffect, useState, useRef } from 'react'
import './App.css'
import { comparePasswordValue, loadPermissionSharedState, normalizePhoneKey, normalizePhoneState, normalizeSharedState, removeExamFromState, revokePhoneAccess, savePermissionSharedState } from './permissionUtils'

const initialQuestions = [] // Start with empty questions - admin will add up to 100 questions

const normalizeQuestions = (value) => {
  if (!Array.isArray(value)) return []

  return value
    .map((item, index) => {
      // Validate basic question structure
      if (!item || typeof item !== 'object') return null
      
      const rawQuestion = typeof item?.question === 'string' ? item.question.trim() : ''
      if (!rawQuestion) return null // Skip questions without text
      
      let rawOptions = item?.options

      // Support object-based or string options saved in older formats
      if (!Array.isArray(rawOptions)) {
        const candidateKeys = [
          'optionA', 'optionB', 'optionC', 'optionD',
          'A', 'B', 'C', 'D',
          'option1', 'option2', 'option3', 'option4',
          '1', '2', '3', '4',
        ]
        const mapped = []
        for (const key of candidateKeys) {
          if (item[key] !== undefined) {
            mapped.push(item[key])
          }
        }
        if (mapped.length > 0) {
          rawOptions = mapped
        } else if (typeof item?.options === 'string') {
          rawOptions = item.options
            .split(/[\n,;\/]+/)
            .map((opt) => opt.trim())
            .filter((opt) => opt.length > 0)
        } else {
          rawOptions = []
        }
      }

      // Flatten nested arrays (corrupted data sometimes has extra nesting)
      const flatOptions = []
      for (const opt of rawOptions) {
        if (Array.isArray(opt)) {
          flatOptions.push(...opt)
        } else {
          flatOptions.push(opt)
        }
      }
      
      // Clean options: keep only meaningful strings
      const cleanedOptions = flatOptions
        .map((opt) => String(opt).trim())
        .map((opt) => opt.replace(/^[A-D][\.|\)]\s+/, '').trim())
        .filter((opt) => opt.length > 0)
        .slice(0, 4) // Take max 4

      if (cleanedOptions.length !== 4) {
        return null
      }

      const options = cleanedOptions

      let answerIndex = Number(item?.answer)
      if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= 4) {
        const answerValue = typeof item?.answer === 'string' ? item.answer.trim() : ''
        const letterIndex = ['A', 'B', 'C', 'D'].indexOf(answerValue.toUpperCase())
        if (letterIndex >= 0) {
          answerIndex = letterIndex
        } else {
          const normalized = answerValue.replace(/^[A-D][\.\)]\s*/, '').trim()
          if (options.includes(normalized)) {
            answerIndex = options.indexOf(normalized)
          } else if (options.includes(answerValue)) {
            answerIndex = options.indexOf(answerValue)
          } else {
            answerIndex = 0
          }
        }
      }
      const safeAnswer = Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < 4
        ? answerIndex
        : 0

      return {
        ...item,
        id: item?.id ?? index + 1,
        question: rawQuestion,
        options,
        answer: safeAnswer,
      }
    })
    .filter(Boolean) // Remove any null entries from invalid questions
}

function App() {
  const [user, setUser] = useState(() => localStorage.getItem('quizUser') || '')
  const [userRole, setUserRole] = useState(() => localStorage.getItem('quizUserRole') || 'user')
  const [nameInput, setNameInput] = useState('')
  const [phoneInput, setPhoneInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [forgotMode, setForgotMode] = useState(false)
  const [currentPhone, setCurrentPhone] = useState(() => localStorage.getItem('quizUser') || '')
  const [adminPassword, setAdminPassword] = useState(() => localStorage.getItem('adminPassword') || 'Venky@2025')
  const [permittedPhones, setPermittedPhones] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('permittedPhones') || '[]')
      return Array.isArray(parsed) ? parsed.map((phone) => String(phone || '').trim().replace(/\D/g, '')).filter(Boolean) : []
    } catch (e) {
      return []
    }
  })
  const [permissionStateReady, setPermissionStateReady] = useState(false)
  // permissionRequests: array of { phone, otp, password, requestedAt }
  const [permissionRequests, setPermissionRequests] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('permissionRequests') || '[]')
      return Array.isArray(parsed)
        ? parsed
            .map((request) => {
              if (!request || typeof request !== 'object') return null
              const phone = String(request.phone || '').trim().replace(/\D/g, '')
              if (!phone) return null
              return { ...request, phone }
            })
            .filter(Boolean)
        : []
    } catch (e) {
      return []
    }
  })
  const [otpInputs, setOtpInputs] = useState({})
  // persisted user store: { phone: password }
  const [users, setUsers] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('quizUsers') || '{}')
      return Object.entries(parsed || {}).reduce((acc, [phone, password]) => {
        const normalizedPhone = String(phone || '').trim().replace(/\D/g, '')
        if (normalizedPhone) {
          acc[normalizedPhone] = password
        }
        return acc
      }, {})
    } catch (e) {
      return {}
    }
  })
  const [resetRequests, setResetRequests] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('resetRequests') || '{}')
    } catch (e) {
      return {}
    }
  })
  const [errorMessage, setErrorMessage] = useState('')
  const [resetCodeInput, setResetCodeInput] = useState('')
  const [newPasswordInput, setNewPasswordInput] = useState('')
  const [quizTitle, setQuizTitle] = useState('My Quiz')
  const [questions, setQuestions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('quizQuestions') || '[]')
      return normalizeQuestions(saved)
    } catch (e) {
      return []
    }
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [videos, setVideos] = useState(() => {
    try {
      // Try multiple possible localStorage keys for backwards compatibility
      const keys = ['uploadedVideos', 'videos', 'savedVideos']
      for (const k of keys) {
        const raw = localStorage.getItem(k)
        if (!raw) continue
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            // normalize entries to have id, title/name, data, viewed
            return parsed.map((v) => {
              if (!v) return null
              if (typeof v === 'string') {
                return { id: String(Date.now() + Math.floor(Math.random() * 10000)), name: 'video', title: 'Video', data: v, viewed: false, uploadedAt: new Date().toISOString() }
              }
              return {
                id: String(v.id || Date.now() + Math.floor(Math.random() * 10000)),
                name: v.name || v.title || 'video',
                title: v.title || v.name || 'Video',
                data: v.data || v.url || '',
                viewed: v.viewed || false,
                uploadedAt: v.uploadedAt || new Date().toISOString(),
              }
            }).filter(Boolean)
          }
        } catch (e) {
          continue
        }
      }
      return []
    } catch (e) {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('uploadedVideos', JSON.stringify(videos))
    } catch (e) {}
  }, [videos])
  const [lastUploadedVideoId, setLastUploadedVideoId] = useState(null)
  const [videoTitleInput, setVideoTitleInput] = useState('')
  const [quizStarted, setQuizStarted] = useState(false)
  const [activeExamQuestions, setActiveExamQuestions] = useState([])
  const [activeExamTitle, setActiveExamTitle] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedOption, setSelectedOption] = useState(null)
  const [score, setScore] = useState(0)
  const [isAnswered, setIsAnswered] = useState(false)
  const [showScore, setShowScore] = useState(false)
  const [viewingStudyNotes, setViewingStudyNotes] = useState(false)
  const [newQuestionText, setNewQuestionText] = useState('')
  const [newOptions, setNewOptions] = useState(['', '', '', ''])
  const [newCorrectIndex, setNewCorrectIndex] = useState(0)
  const [exams, setExams] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('quizExams') || '{}')
    } catch (e) {
      return {}
    }
  })
  const [examDateInput, setExamDateInput] = useState('')
  const [examSizeInput, setExamSizeInput] = useState(20)
  const [lastCreatedExamDate, setLastCreatedExamDate] = useState(null)
  const [notifications, setNotifications] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('quizNotifications') || '[]')
    } catch (e) {
      return []
    }
  })
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false)
  const [notificationRecipients, setNotificationRecipients] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('notificationRecipients') || '[]')
    } catch (e) {
      return []
    }
  })
  const [newRecipientInput, setNewRecipientInput] = useState('')
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('desktopNotificationsEnabled') || 'false')
    } catch (e) {
      return false
    }
  })

  const bcRef = useRef(null)
  // SEPARATE Study Materials System (Independent from Quiz)
  const [studyNotes, setStudyNotes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('studyNotes') || '[]')
    } catch (e) {
      return []
    }
  })
  const [studySubjects, setStudySubjects] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('studySubjects') || '[]')
    } catch (e) {
      return []
    }
  })
  const [newStudySubject, setNewStudySubject] = useState('')
  const [newStudyTopic, setNewStudyTopic] = useState('')
  const [newStudyQuestion, setNewStudyQuestion] = useState('')
  const [newStudyAnswer, setNewStudyAnswer] = useState('')
  const [newStudyExplanation, setNewStudyExplanation] = useState('')
  const [studentDashboardView, setStudentDashboardView] = useState(() => localStorage.getItem('studentDashboardView') || 'videos')
  const [resourcePageOpen, setResourcePageOpen] = useState(false)
  const [selectedVideoId, setSelectedVideoId] = useState(null)
  const [selectedStudySubject, setSelectedStudySubject] = useState(() => localStorage.getItem('selectedStudySubject') || null)
  const [expandedSubject, setExpandedSubject] = useState(null)

  useEffect(() => {
    try {
      localStorage.setItem('adminPassword', adminPassword)
    } catch (e) {}
  }, [adminPassword])

  useEffect(() => {
    // Remove any stale video selection persisted by older versions.
    // This prevents the app from jumping directly into a previously-opened video.
    try {
      localStorage.removeItem('selectedVideoId')
    } catch (e) {}

    if (userRole === 'user') {
      setSelectedVideoId(null)
      setResourcePageOpen(false)
    }
  }, [userRole])

  // Do not auto-open the first video when opening the Videos view.
  // Users expect to see the list first and open a specific video by clicking it.

  useEffect(() => {
    if (user) {
      localStorage.setItem('quizUser', user)
      localStorage.setItem('quizUserRole', userRole)
    }
  }, [user, userRole])

  useEffect(() => {
    let active = true

    const hydratePermissionState = async () => {
      const remoteState = await loadPermissionSharedState()
      if (!active) return

      if (remoteState) {
        const localSnapshot = {
          permittedPhones,
          permissionRequests,
          users,
          questions,
          exams,
          adminPassword,
          quizTitle,
          studyNotes,
          studySubjects,
          notifications,
          notificationRecipients,
          desktopNotificationsEnabled,
          videos,
        }
        const merged = mergeSharedState(localSnapshot, remoteState)
        setPermittedPhones(merged.permittedPhones)
        setPermissionRequests(merged.permissionRequests)
        setUsers(merged.users)
        setAdminPassword(merged.adminPassword || adminPassword)
        setQuestions(merged.questions || [])
        setExams(merged.exams || {})
        setQuizTitle(merged.quizTitle || 'My Quiz')
        setStudyNotes(merged.studyNotes || [])
        setStudySubjects(merged.studySubjects || [])
        setNotifications(merged.notifications || [])
        setNotificationRecipients(merged.notificationRecipients || [])
        setDesktopNotificationsEnabled(Boolean(merged.desktopNotificationsEnabled))
        if (Array.isArray(merged.videos)) {
          setVideos(merged.videos)
        }
      }

      setPermissionStateReady(true)
    }

    hydratePermissionState()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!permissionStateReady) return

    const payload = normalizeSharedState({
      permittedPhones,
      permissionRequests,
      users,
      adminPassword,
      questions,
      exams,
      quizTitle,
      studyNotes,
      studySubjects,
      notifications,
      notificationRecipients,
      desktopNotificationsEnabled,
      videos,
    })

    try {
      localStorage.setItem('permittedPhones', JSON.stringify(payload.permittedPhones))
      localStorage.setItem('permissionRequests', JSON.stringify(payload.permissionRequests))
      localStorage.setItem('quizUsers', JSON.stringify(payload.users))
      localStorage.setItem('quizQuestions', JSON.stringify(normalizeQuestions(payload.questions)))
      localStorage.setItem('quizExams', JSON.stringify(payload.exams))
      localStorage.setItem('studyNotes', JSON.stringify(payload.studyNotes))
      localStorage.setItem('studySubjects', JSON.stringify(payload.studySubjects))
      localStorage.setItem('quizNotifications', JSON.stringify(payload.notifications))
      localStorage.setItem('notificationRecipients', JSON.stringify(payload.notificationRecipients))
      localStorage.setItem('desktopNotificationsEnabled', JSON.stringify(payload.desktopNotificationsEnabled))
      localStorage.setItem('uploadedVideos', JSON.stringify(payload.videos))
      localStorage.setItem('adminPassword', payload.adminPassword || adminPassword)
      localStorage.setItem('quizTitle', payload.quizTitle || 'My Quiz')
    } catch (e) {}

    savePermissionSharedState(payload).catch(() => {})
  }, [permissionStateReady, permittedPhones, permissionRequests, users, adminPassword, questions, exams, quizTitle, studyNotes, studySubjects, notifications, notificationRecipients, desktopNotificationsEnabled, videos])

  useEffect(() => {
    try {
      localStorage.setItem('resetRequests', JSON.stringify(resetRequests))
    } catch (e) {}
  }, [resetRequests])

  useEffect(() => {
    try {
      localStorage.setItem('quizQuestions', JSON.stringify(normalizeQuestions(questions)))
    } catch (e) {}
  }, [questions])

  useEffect(() => {
    try {
      localStorage.setItem('quizExams', JSON.stringify(exams))
    } catch (e) {}
  }, [exams])

  useEffect(() => {
    try {
      localStorage.setItem('uploadedVideos', JSON.stringify(videos))
    } catch (e) {}
  }, [videos])

  // Auto-scroll to the last uploaded video button when a new video is added
  useEffect(() => {
    if (!lastUploadedVideoId) return
    const el = document.getElementById(`video-btn-${lastUploadedVideoId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // brief highlight by focusing then blurring
      try {
        el.focus()
        setTimeout(() => el.blur(), 600)
      } catch (e) {}
    }
    // clear the marker
    setLastUploadedVideoId(null)
  }, [lastUploadedVideoId])

  useEffect(() => {
    if (selectedVideoId && videos.length > 0 && !videos.some((v) => v.id === selectedVideoId)) {
      setSelectedVideoId(null)
    }
  }, [selectedVideoId, videos])

  useEffect(() => {
    try {
      localStorage.setItem('studyNotes', JSON.stringify(studyNotes))
    } catch (e) {}
  }, [studyNotes])

  useEffect(() => {
    try {
      localStorage.setItem('studySubjects', JSON.stringify(studySubjects))
    } catch (e) {}
  }, [studySubjects])
  useEffect(() => {
    try {
      localStorage.setItem('quizNotifications', JSON.stringify(notifications))
    } catch (e) {}
  }, [notifications])
  useEffect(() => {
    try {
      localStorage.setItem('notificationRecipients', JSON.stringify(notificationRecipients))
    } catch (e) {}
  }, [notificationRecipients])
  useEffect(() => {
    try {
      localStorage.setItem('desktopNotificationsEnabled', JSON.stringify(desktopNotificationsEnabled))
    } catch (e) {}
  }, [desktopNotificationsEnabled])

  // Initialize BroadcastChannel for in-app push between tabs
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('quiz-notifications')
        bcRef.current = bc
        bc.onmessage = (ev) => {
          const note = ev.data
          if (note && note.id) {
            setNotifications((prev) => [note, ...prev])
            // show desktop notification if enabled
            if (desktopNotificationsEnabled && window.Notification && Notification.permission === 'granted') {
              try {
                new Notification(note.title, { body: note.message })
              } catch (e) {}
            }
          }
        }
        return () => {
          try { bc.close() } catch (e) {}
        }
      }
    } catch (e) {}
  }, [desktopNotificationsEnabled])

  const removePhoneAccess = (phone) => {
    const normalizedPhone = String(phone || '').trim()
    if (!normalizedPhone) return

    const nextState = revokePhoneAccess(
      {
        permittedPhones,
        permissionRequests,
        users,
      },
      normalizedPhone
    )

    setPermittedPhones(nextState.permittedPhones)
    setPermissionRequests(nextState.permissionRequests)
    setUsers(nextState.users)
    setErrorMessage(`Removed access for ${normalizedPhone}`)
  }

  const isAdmin = userRole === 'admin'
  const currentQuestions = quizStarted
    ? activeExamQuestions.length > 0
      ? activeExamQuestions
      : questions
    : questions
  const question = currentQuestions[currentIndex] || null
  const cleanedQuestionOptions = question && Array.isArray(question.options)
    ? question.options
        .map((opt) => String(opt).trim())
        .slice(0, 4)
    : []
  const questionOptions = cleanedQuestionOptions.length === 4
    ? cleanedQuestionOptions
    : ['Option A', 'Option B', 'Option C', 'Option D']
  const isCorrect = selectedOption === question?.answer

  const loginStatusMessage = (() => {
    const phone = normalizePhoneKey(phoneInput)
    if (phone) {
      const normalizedPermittedPhones = permittedPhones.map((entry) => normalizePhoneKey(entry))
      const normalizedPermissionRequests = permissionRequests.map((entry) => ({ ...entry, phone: normalizePhoneKey(entry.phone) }))
      if (normalizedPermittedPhones.includes(phone)) {
        return 'This phone has permission. Enter your password to login and take exams.'
      }
      if (normalizedPermissionRequests.some((r) => r.phone === phone)) {
        return 'Permission request is pending. Teacher must approve your OTP before you can take exams.'
      }
      return 'New phone detected. After you submit, the teacher will receive an OTP to approve your access.'
    }
    if (nameInput.trim()) {
      return 'Admin login: enter your password to access the dashboard.'
    }
    return 'Student login uses phone and password. First-time users request approval from the teacher.'
  })()

  const handleOptionClick = (optionIndex) => {
    if (isAnswered) return
    setSelectedOption(optionIndex)
  }

  const handleSubmit = () => {
    if (selectedOption === null) return
    if (isCorrect) {
      setScore((prev) => prev + 1)
    }
    setIsAnswered(true)
  }

  const handleNext = () => {
    const nextIndex = currentIndex + 1
    if (nextIndex < currentQuestions.length) {
      setCurrentIndex(nextIndex)
      setSelectedOption(null)
      setIsAnswered(false)
    } else {
      setShowScore(true)
    }
  }

  const resetQuiz = () => {
    setCurrentIndex(0)
    setSelectedOption(null)
    setScore(0)
    setIsAnswered(false)
    setShowScore(false)
  }

  const handleRestart = () => {
    resetQuiz()
  }

  const handleLogout = () => {
    resetQuiz()
    setQuizStarted(false)
    setUser('')
    setUserRole('user')
    localStorage.removeItem('quizUser')
    localStorage.removeItem('quizUserRole')
  }

  const handleLogin = (event) => {
    event.preventDefault()
    const name = nameInput.trim()
    const adminNames = ['venkatesh', 'venjatesh', 'admin', 'teacher']
    // Only accept exact admin username+password
    if (name && adminNames.includes(name.toLowerCase()) && comparePasswordValue(passwordInput, adminPassword)) {
      setUser(name)
      setUserRole('admin')
      setNameInput('')
      setPasswordInput('')
      setCurrentPhone('')
      setErrorMessage('')
      setForgotMode(false)
      return
    }

    if (forgotMode) {
      const phone = normalizePhoneKey(phoneInput)
      if (!phone) {
        setErrorMessage('Enter your phone to reset your password')
        return
      }
      const resetRequest = resetRequests[phone]
      if (!resetRequest) {
        setErrorMessage('No reset code requested for this phone')
        return
      }
      if (resetCodeInput.trim() !== resetRequest.code) {
        setErrorMessage('Reset code is incorrect')
        return
      }
      if (!newPasswordInput.trim()) {
        setErrorMessage('Enter a new password')
        return
      }
      setUsers((prev) => ({ ...prev, [phone]: newPasswordInput.trim() }))
      setResetRequests((prev) => {
        const copy = { ...prev }
        delete copy[phone]
        return copy
      })
      setErrorMessage('Password reset successfully. Login with your new password.')
      setForgotMode(false)
      setResetCodeInput('')
      setNewPasswordInput('')
      return
    }

    if (phoneInput.trim() && passwordInput) {
      const phone = normalizePhoneKey(phoneInput)
      if (!phone) {
        setErrorMessage('Enter a valid phone number')
        return
      }
      const normalizedPermittedPhones = permittedPhones.map((entry) => normalizePhoneKey(entry))
      const normalizedPermissionRequests = permissionRequests.map((entry) => ({ ...entry, phone: normalizePhoneKey(entry.phone) }))
      const hasPermission = normalizedPermittedPhones.includes(phone)
      if (hasPermission) {
        if (users[phone]) {
          if (comparePasswordValue(passwordInput, users[phone])) {
            setUser(phone)
            setUserRole('user')
            setCurrentPhone(phone)
            setNameInput('')
            setPasswordInput('')
            setPhoneInput('')
            setErrorMessage('')
          } else {
            setErrorMessage('Incorrect password for this phone')
          }
        } else {
          setUsers((prev) => ({ ...prev, [phone]: passwordInput }))
          setUser(phone)
          setUserRole('user')
          setCurrentPhone(phone)
          setNameInput('')
          setPasswordInput('')
          setPhoneInput('')
          setErrorMessage('')
        }
      } else {
        const existing = normalizedPermissionRequests.find((r) => r.phone === phone)
        if (!existing) {
          const otp = String(Math.floor(100000 + Math.random() * 900000))
          const req = { phone, otp, password: passwordInput.trim(), requestedAt: new Date().toISOString() }
          setPermissionRequests((prev) => [...prev, req])
          setErrorMessage('Permission requested. Teacher will receive OTP to approve.')
        } else {
          setErrorMessage('Permission already requested. Wait for teacher approval.')
        }
      }
    } else if (name) {
      setErrorMessage('Admin login requires password')
    } else {
      setErrorMessage('Enter phone and password to login or request access')
    }
  }

  const handleAddQuestion = () => {
    const text = newQuestionText.trim()
    const trimmedOptions = newOptions.map((option) => option.trim()).slice(0, 4) // Ensure exactly 4 options

    // Validate: question text and all 4 options must be filled
    if (!text || trimmedOptions.length !== 4 || trimmedOptions.some((option) => option === '')) {
      setErrorMessage('Question and all 4 options must be filled')
      return
    }

    if (questions.length >= 100) {
      setErrorMessage('Maximum of 100 questions reached')
      return
    }

    setQuestions((prev) => [
      ...prev,
      {
        id: prev.length + 1,
        question: text,
        options: trimmedOptions, // Always exactly 4 options
        answer: newCorrectIndex,
      },
    ])

    setNewQuestionText('')
    setNewOptions(['', '', '', ''])
    setNewCorrectIndex(0)
    setErrorMessage('')
  }

  const handleAddStudyNote = () => {
    const question = newStudyQuestion.trim()
    const subject = newStudySubject.trim()
    const answer = newStudyAnswer.trim()
    const explanation = newStudyExplanation.trim()

    // Validate
    if (!question || !subject || !answer) {
      setErrorMessage('Subject, Question, and Answer are required')
      return
    }

    // Add subject if not already present
    if (!studySubjects.includes(subject)) {
      setStudySubjects((prev) => [...prev, subject])
    }

    // Add study note
    setStudyNotes((prev) => [
      ...prev,
      {
        id: Date.now(),
        subject: subject,
        topic: newStudyTopic.trim() || '',
        question: question,
        answer: answer,
        explanation: explanation,
      },
    ])

    // Reset form
    setNewStudySubject('')
    setNewStudyTopic('')
    setNewStudyQuestion('')
    setNewStudyAnswer('')
    setNewStudyExplanation('')
    setErrorMessage('')
  }

  const handleRemoveStudyNote = (id) => {
    if (!window.confirm('Remove this study material?')) return
    setStudyNotes((prev) => {
      const next = prev.filter((n) => n.id !== id)
      // update subjects if a subject has no materials left
      const remainingSubjects = Array.from(new Set(next.map((n) => n.subject)))
      setStudySubjects(remainingSubjects)
      return next
    })
  }

  const handleStartQuiz = () => {
    if (!quizTitle.trim() || questions.length === 0) return
    setActiveExamQuestions(questions.slice(0, 100))
    setActiveExamTitle(quizTitle)
    setQuizStarted(true)
    resetQuiz()
  }

  const handleReturnToDashboard = () => {
    setQuizStarted(false)
    setShowScore(false)
    setActiveExamQuestions([])
    setActiveExamTitle('')
    resetQuiz()
  }

  const visibleQuestions = searchTerm.trim()
    ? questions.filter((question) =>
        question.question.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : questions

  const handleVideoUpload = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target.result
      const vid = {
        id: String(Date.now() + Math.floor(Math.random() * 10000)),
        name: file.name,
        title: (videoTitleInput || file.name).trim(),
        data: dataUrl,
        viewed: false,
        uploadedAt: new Date().toISOString(),
      }
      setVideos((prev) => {
        const next = [...prev, vid]
        setLastUploadedVideoId(vid.id)
        return next
      })
      setVideoTitleInput('')
    }
    reader.readAsDataURL(file)
    // clear input so same file can be re-selected later
    try {
      event.target.value = ''
    } catch (e) {}
  }

  // CSV import for bulk questions (admin-only). CSV columns: question,optionA,optionB,optionC,optionD,answerIndex
  const handleImportCSV = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const parsed = []
      for (const line of lines) {
        const cols = line.split(',')
        if (cols.length !== 6) continue
        const [q, a, b, c, d, ans] = cols.map((c) => c.trim())
        const answerIndex = Number(ans)
        if (!q || !a || !b || !c || !d) continue
        if (Number.isNaN(answerIndex) || answerIndex < 0 || answerIndex > 3) continue
        parsed.push({
          id: Date.now() + Math.floor(Math.random() * 10000),
          question: q,
          options: [a, b, c, d],
          answer: answerIndex,
        })
      }
      if (parsed.length) {
        setQuestions((prev) => {
          const remaining = 100 - prev.length
          if (remaining <= 0) {
            setErrorMessage('Cannot import more questions: maximum of 100 reached.')
            return prev
          }
          const toAdd = parsed.slice(0, remaining)
          if (toAdd.length < parsed.length) {
            setErrorMessage(`Imported ${toAdd.length} questions; ${parsed.length - toAdd.length} were skipped because the 100-question limit was reached.`)
          }
          return [...prev, ...toAdd]
        })
      } else {
        setErrorMessage('CSV import failed: each row must include a question, 4 options, and an answer index.')
      }
    }
    reader.readAsText(file)
    // clear input value so same file can be re-selected later
    event.target.value = ''
  }

  // Create an exam for a given date with N questions (default 20), valid for 24 hours
  const handleCreateExam = (dateStr, count = 20) => {
    const today = new Date().toISOString().slice(0, 10)
    const examDate = dateStr?.trim() || today

    // pick up to `count` random questions from pool+
    // Only include questions that have exactly 4 non-empty options
    const pool = questions.filter((q) => Array.isArray(q.options) && q.options.filter(Boolean).length === 4)
    if (pool.length === 0) {
      setErrorMessage('No valid 4-option questions available to create an exam.')
      return
    }
    const selected = []
    const available = [...pool]
    const target = Math.min(count, available.length)
    while (selected.length < target) {
      const idx = Math.floor(Math.random() * available.length)
      selected.push(available.splice(idx, 1)[0])
    }
    const now = new Date().toISOString()
    setExams((prev) => ({
      ...prev,
      [examDate]: {
        title: `Exam ${examDate}`,
        questions: selected,
        createdAt: now, // Store creation timestamp
        expiresAt: new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
      },
    }))
    setExamDateInput(examDate)
    setLastCreatedExamDate(examDate)
    setErrorMessage(`Exam created for ${examDate}, valid for 24 hours.`)
    // push a user notification so students see new exam
    const note = {
      id: `n_${Date.now()}`,
      type: 'exam',
      title: `Exam scheduled ${examDate}`,
      message: `An exam for ${examDate} has been created (${selected.length} questions).`,
      date: new Date().toISOString(),
      read: false,
    }
    setNotifications((prev) => [note, ...prev])
    // broadcast to other tabs/windows for in-app push
    try {
      if (bcRef.current) bcRef.current.postMessage(note)
      // also show desktop notification if enabled
      if (desktopNotificationsEnabled && window.Notification && Notification.permission === 'granted') {
        try { new Notification(note.title, { body: note.message }) } catch (e) {}
      }
      // if permission not yet granted, request it when admin enables
    } catch (e) {}
    // send server-side emails if configured and recipients exist
    try {
      if (notificationRecipients && notificationRecipients.length > 0) {
        fetch((process.env.REACT_APP_BACKEND_URL || '') + '/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: notificationRecipients,
            subject: note.title,
            text: note.message,
            html: `<p>${note.message}</p><p>Exam date: ${examDate}</p>`,
          }),
        })
          .then((r) => r.json())
          .catch((err) => console.error(err))
      }
    } catch (e) {
      console.error(e)
    }
    // clear highlight after a short while
    setTimeout(() => setLastCreatedExamDate(null), 7000)
  }

  const handleClearAllData = () => {
    if (window.confirm('Are you sure? This will delete all questions, exams, videos, and user data. This cannot be undone.')) {
      localStorage.removeItem('quizQuestions')
      localStorage.removeItem('quizExams')
      localStorage.removeItem('uploadedVideos')
      localStorage.removeItem('quizUsers')
      localStorage.removeItem('permissionRequests')
      localStorage.removeItem('permittedPhones')
      localStorage.removeItem('resetRequests')
      setQuestions([])
      setExams({})
      setVideos([])
      setUsers({})
      setPermissionRequests([])
      setPermittedPhones([])
      setResetRequests({})
      setErrorMessage('All data has been cleared. Start fresh!')
    }
  }

  const getActiveExam = () => {
    const now = new Date()
    const activeExams = Object.values(exams)
      .filter((exam) => {
        if (!exam) return false
        const expiresAt = exam.expiresAt ? new Date(exam.expiresAt) : new Date(exam.createdAt || 0)
        return now <= expiresAt
      })
    if (activeExams.length === 0) return null
    return activeExams.reduce((latest, exam) => {
      const latestCreated = new Date(latest.createdAt || 0)
      const examCreated = new Date(exam.createdAt || 0)
      return examCreated > latestCreated ? exam : latest
    }, activeExams[0])
  }

  const handleStartExamToday = () => {
    const todays = getActiveExam()
    if (!todays) {
      setErrorMessage('No active exam is available or the 24-hour window has expired.')
      return
    }

    const valid = Array.isArray(todays.questions)
      ? todays.questions.filter((q) => Array.isArray(q.options) && q.options.length === 4).slice(0, 100)
      : []
    if (valid.length === 0) {
      setErrorMessage('Active exam contains no valid 4-option questions. Contact admin.')
      return
    }

    const phone = String(currentPhone || user || '').trim().replace(/\D/g, '')
    const normalizedPermittedPhones = permittedPhones.map((entry) => String(entry || '').trim().replace(/\D/g, ''))
    if (userRole === 'admin' || normalizedPermittedPhones.includes(phone)) {
      setActiveExamQuestions(valid)
      setActiveExamTitle(todays.title || quizTitle)
      setCurrentIndex(0)
      setSelectedOption(null)
      setScore(0)
      setIsAnswered(false)
      setShowScore(false)
      setQuizStarted(true)
      return
    }

    const exists = permissionRequests.find((r) => String(r.phone || '').trim().replace(/\D/g, '') === phone)
    if (!exists) {
      const otp = String(Math.floor(100000 + Math.random() * 900000))
      const req = { phone, otp, password: '', requestedAt: new Date().toISOString() }
      setPermissionRequests((prev) => [...prev, req])
    }
    setErrorMessage('You are not permitted to take this exam yet. Permission requested from admin.')
  }

  // small component to manage permitted phones inside this file
  function PermittedPhonesManager() {
    return (
      <div>
        {permittedPhones.length === 0 ? (
          <p>No permitted phones yet.</p>
        ) : (
          <ul>
            {permittedPhones.map((p) => (
              <li key={p}>
                {p}{' '}
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(`Revoke permission for ${p}?`)) return
                    removePhoneAccess(p)
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // Admin debug panel: shows permitted phones, users, and exams with simple management actions
  function AdminDebugPanel() {
    const revokePhone = (p) => {
      if (!window.confirm(`Revoke permission for ${p}?`)) return
      removePhoneAccess(p)
    }

    const removeUser = (u) => {
      if (!window.confirm(`Remove stored user record for ${u}? This cannot be undone.`)) return
      setUsers((prev) => {
        const copy = { ...prev }
        delete copy[u]
        return copy
      })
      setErrorMessage(`Removed user record for ${u}`)
    }

    const removeExam = (key) => {
      if (!window.confirm(`Remove exam ${key}? This will delete the exam and its questions.`)) return
      setExams((prev) => removeExamFromState(prev, key))
      setErrorMessage(`Removed exam ${key}`)
    }

    return (
      <div className="admin-debug" style={{ marginTop: 12, padding: 12, border: '1px dashed #ccc', borderRadius: 6 }}>
        <h3>Admin Debug</h3>
        <div style={{ marginBottom: 8 }}>
          <strong>Permitted phones:</strong>
          {permittedPhones.length === 0 ? <div>None</div> : (
            <ul>
              {permittedPhones.map((p) => (
                <li key={p} style={{ marginBottom: 4 }}>
                  {p}{' '}
                  <button type="button" onClick={() => revokePhone(p)}>Revoke</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginBottom: 8 }}>
          <strong>Users ({Object.keys(users).length}):</strong>
          {Object.keys(users).length === 0 ? <div>None</div> : (
            <ul>
              {Object.keys(users).map((u) => (
                <li key={u} style={{ marginBottom: 4 }}>
                  {u} — <small>password stored</small>{' '}
                  <button type="button" onClick={() => removeUser(u)}>Remove user</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <strong>Exams ({Object.keys(exams).length}):</strong>
          {Object.keys(exams).length === 0 ? <div>None</div> : (
            <ul>
              {Object.entries(exams).map(([k, ex]) => (
                <li key={k} style={{ marginBottom: 6 }}>
                  <div><strong>{k}</strong> — {ex.title || ''}</div>
                  <div>Questions: {Array.isArray(ex.questions) ? ex.questions.length : 0}</div>
                  <div>Created: {ex.createdAt || 'n/a'} — Expires: {ex.expiresAt || 'n/a'}</div>
                  <div style={{ marginTop: 4 }}>
                    <button type="button" onClick={() => removeExam(k)}>Remove exam</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>Admin / Student Login</h1>
          <form onSubmit={handleLogin} className="login-form" autoComplete="off">
            <p className="login-note">Admin: enter your name and password. Student: enter phone and password to request access.</p>
            <p className="login-note">New students must request permission here, then the admin approves them before they can take the exam.</p>
            
            <label htmlFor="name">Name</label>
            <input
              id="name"
              name="loginName"
              type="text"
              autoComplete="off"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Your name"
            />
            <label htmlFor="phone">Phone (students login with phone)</label>
            <input
              id="phone"
              name="loginPhone"
              type="tel"
              autoComplete="off"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="Student phone (digits only)"
            />
            {phoneInput.trim() && <p className="login-status">{loginStatusMessage}</p>}
            {!forgotMode && (
              <>
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  name="loginPassword"
                  type="password"
                  autoComplete="new-password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Admin or student password"
                />
              </>
            )}
            {forgotMode && (
              <>
                <label htmlFor="reset-code">Reset code</label>
                <input
                  id="reset-code"
                  type="text"
                  value={resetCodeInput}
                  onChange={(e) => setResetCodeInput(e.target.value)}
                  placeholder="Enter reset code"
                />
                <label htmlFor="new-password">New password</label>
                <input
                  id="new-password"
                  type="password"
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  placeholder="Enter new password"
                />
              </>
            )}
            {errorMessage && <p className="error-text">{errorMessage}</p>}
            <button type="submit" className="primary-button" disabled={forgotMode ? !resetCodeInput.trim() || !newPasswordInput.trim() || !phoneInput.trim() : !passwordInput || (!nameInput.trim() && !phoneInput.trim())}>
              {forgotMode ? 'Reset password' : 'Login'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setForgotMode((prev) => !prev)
                setErrorMessage('')
              }}
            >
              {forgotMode ? 'Back to login' : 'Forgot password?'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (!quizStarted) {
    return (
      <div className="quiz-app">
        <header className="quiz-header">
          <div className="quiz-header-top">
            <div>
              <h1>{isAdmin ? 'Create Quiz' : 'Student Dashboard'}</h1>
              <p>
                {isAdmin
                  ? `Welcome, ${user}. Set your quiz title and start when ready.`
                  : `Welcome, ${user}. Start your scheduled MCQ exam when available.`}
              </p>
            </div>
            {isAdmin && lastCreatedExamDate && (
              <div style={{ position: 'fixed', right: 20, top: 80, background: '#323232', color: '#fff', padding: '10px 14px', borderRadius: 6, boxShadow: '0 6px 18px rgba(0,0,0,0.2)', zIndex: 60 }}>
                <div style={{ fontWeight: 600 }}>Exam created</div>
                <div style={{ fontSize: 13 }}>Exam for {lastCreatedExamDate} created successfully.</div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <button type="button" className="secondary-button" onClick={() => setShowNotificationsPanel((s) => !s)}>
                  🔔 Notifications
                </button>
                {notifications.filter((n) => !n.read).length > 0 && (
                  <span style={{ position: 'absolute', top: -6, right: -6, background: '#d32f2f', color: '#fff', borderRadius: 10, padding: '2px 6px', fontSize: 12 }}>
                    {notifications.filter((n) => !n.read).length}
                  </span>
                )}
                {showNotificationsPanel && (
                  <div style={{ position: 'absolute', right: 0, top: 36, width: 320, maxHeight: 320, overflowY: 'auto', background: '#fff', boxShadow: '0 6px 18px rgba(0,0,0,0.12)', borderRadius: 6, padding: 8, zIndex: 40 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <strong>Notifications</strong>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="secondary-button" onClick={() => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))}>Mark all read</button>
                        <button type="button" className="secondary-button" onClick={() => {
                          if (!('Notification' in window)) {
                            setErrorMessage('This browser does not support desktop notifications')
                            return
                          }
                          if (Notification.permission === 'granted') {
                            setDesktopNotificationsEnabled((s) => !s)
                          } else if (Notification.permission !== 'denied') {
                            Notification.requestPermission().then((perm) => {
                              if (perm === 'granted') setDesktopNotificationsEnabled(true)
                              else setDesktopNotificationsEnabled(false)
                            })
                          } else {
                            setErrorMessage('Desktop notifications are blocked in your browser. Allow them in browser settings.')
                          }
                        }}>{desktopNotificationsEnabled ? 'Disable desktop' : 'Enable desktop'}</button>
                      </div>
                    </div>
                    {notifications.length === 0 ? <div style={{ color: '#666' }}>No notifications</div> : (
                      notifications.map((n) => (
                        <div key={n.id} style={{ padding: 8, borderBottom: '1px solid #eee', background: n.read ? 'transparent' : '#f7f7ff' }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{n.title}</div>
                          <div style={{ fontSize: 13, color: '#444' }}>{n.message}</div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                            {!n.read && <button type="button" className="primary-button" onClick={() => setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x))}>Mark read</button>}
                            <button type="button" className="secondary-button" onClick={() => setNotifications((prev) => prev.filter((x) => x.id !== n.id))}>Dismiss</button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <button type="button" className="secondary-button" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>

          <div className="dashboard-section">
            <h2>Exams</h2>
            {isAdmin ? (
              <>
                <div className="exam-creator">
                  <label htmlFor="exam-date">Exam date</label>
                  <input id="exam-date" type="date" value={examDateInput} onChange={(e) => setExamDateInput(e.target.value)} />
                  <label htmlFor="exam-size">Size (max 100)</label>
                  <input id="exam-size" type="number" min={1} max={100} value={examSizeInput} onChange={(e) => setExamSizeInput(Number(e.target.value))} />
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      if (examDateInput) {
                        const size = Math.min(100, Math.max(1, Number(examSizeInput) || 20))
                        handleCreateExam(examDateInput, size)
                      }
                    }}
                    disabled={!examDateInput || questions.length === 0}
                  >
                    Create Exam
                  </button>
                </div>
                <div style={{ marginTop: 12 }}>
                  <h3>Notification Recipients (emails)</h3>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="email" placeholder="email@example.com" value={newRecipientInput} onChange={(e) => setNewRecipientInput(e.target.value)} />
                    <button type="button" className="primary-button" onClick={() => {
                      const email = (newRecipientInput || '').trim()
                      if (!email) return
                      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                        setErrorMessage('Invalid email address')
                        return
                      }
                      if (!notificationRecipients.includes(email)) setNotificationRecipients((p) => [email, ...p])
                      setNewRecipientInput('')
                      setErrorMessage('')
                    }}>Add recipient</button>
                  </div>
                  {notificationRecipients.length === 0 ? <div style={{ color: '#666', marginTop: 8 }}>No recipients configured.</div> : (
                    <ul style={{ marginTop: 8 }}>
                      {notificationRecipients.map((r) => (
                        <li key={r} style={{ marginBottom: 6 }}>
                          {r} <button type="button" onClick={() => setNotificationRecipients((prev) => prev.filter((x) => x !== r))}>Remove</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {Object.keys(exams).length > 0 && (
                  <div className="dashboard-section" style={{ marginTop: 16 }}>
                    <h2>Scheduled Daily Exams</h2>
                    <p>Manage exams and see which ones are currently active.</p>
                    <ul style={{ marginLeft: 16 }}>
                      {Object.entries(exams)
                        .sort(([a], [b]) => new Date(a) - new Date(b))
                        .map(([date, exam]) => {
                          const expiresAt = exam.expiresAt ? new Date(exam.expiresAt) : null
                          const now = new Date()
                          const active = expiresAt ? now <= expiresAt : false
                          return (
                            <li key={date} style={{ marginBottom: 8 }}>
                                  <div id={`exam-${date}`} style={{ padding: 6, borderRadius: 4, backgroundColor: date === lastCreatedExamDate ? '#fff8e1' : 'transparent' }}>
                                    <strong>{date}</strong> — {exam.title || `Exam ${date}`} ({Array.isArray(exam.questions) ? exam.questions.length : 0} questions)
                                  </div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                                <div style={{ fontSize: 13, color: active ? '#1b5e20' : '#b71c1c' }}>
                                  {active ? `Active until ${expiresAt?.toLocaleString()}` : `Expired ${expiresAt?.toLocaleString()}`}
                                </div>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => {
                                    if (!window.confirm(`Remove exam ${date}?`)) return
                                    setExams((prev) => removeExamFromState(prev, date))
                                    setErrorMessage(`Removed exam ${date}`)
                                  }}
                                >
                                  {active ? 'Remove exam' : 'Remove expired exam'}
                                </button>
                              </div>
                                  {date === lastCreatedExamDate && (
                                    <script dangerouslySetInnerHTML={{ __html: `setTimeout(()=>{const el=document.getElementById('exam-${date}'); if(el) el.scrollIntoView({behavior:'smooth',block:'center'});},50)` }} />
                                  )}
                            </li>
                          )
                        })}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="exam-user">
                {getActiveExam() ? (
                  <>
                    <p>An active exam is available (valid for 24 hours from creation).</p>
                    <button type="button" className="primary-button" onClick={handleStartExamToday}>
                      Start Available Exam
                    </button>
                  </>
                ) : (
                  <p>No active exam is available or the 24-hour window has expired.</p>
                )}
              </div>
            )}

          {(videos.length > 0 || studyNotes.length > 0) && (
            <div className="dashboard-section">
              <h2>Learning Resources</h2>
              <p>Select either videos or study materials to browse content separately.</p>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button
                  type="button"
                  className={studentDashboardView === 'videos' ? 'primary-button' : 'secondary-button'}
                  onClick={() => {
                    setStudentDashboardView('videos')
                    setSelectedStudySubject(null)
                    setSelectedVideoId(null) // show list first; user opens a video by clicking
                    setResourcePageOpen(true)
                  }}
                >
                  Videos
                </button>
                <button
                  type="button"
                  className={studentDashboardView === 'materials' ? 'primary-button' : 'secondary-button'}
                  onClick={() => {
                    setStudentDashboardView('materials')
                    setSelectedVideoId(null)
                    setResourcePageOpen(true)
                  }}
                >
                  Study Materials
                </button>
              </div>

              {resourcePageOpen ? (
                <div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setResourcePageOpen(false)}
                    style={{ marginBottom: 12 }}
                  >
                    ◀ Back to dashboard
                  </button>
                  {studentDashboardView === 'videos' ? (
                    <div>
                      <h3>Videos</h3>
                      <p style={{ margin: '4px 0 12px 0', color: '#555', fontSize: '0.95em' }}>
                        Uploaded videos are saved in your browser and remain available after refresh, browser reopen, or logout.
                      </p>
                      {videos.length === 0 ? (
                        <p>No videos have been uploaded yet.</p>
                      ) : selectedVideoId ? (
                        <div>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            <button type="button" className="secondary-button" onClick={() => setSelectedVideoId(null)}>
                              ◀ Back to video list
                            </button>
                            <a
                              className="secondary-button"
                              href={videos.find((v) => v.id === selectedVideoId)?.data}
                              download={videos.find((v) => v.id === selectedVideoId)?.name || 'video'}
                              style={{ textDecoration: 'none', display: 'inline-block' }}
                            >
                              Download
                            </a>
                            {isAdmin && (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => {
                                  if (!window.confirm('Delete this video?')) return
                                  const id = selectedVideoId
                                  setVideos((prev) => prev.filter((v) => v.id !== id))
                                  setSelectedVideoId(null)
                                }}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          <div style={{ marginTop: 12 }}>
                            <h4>Selected video</h4>
                            <video controls src={videos.find((v) => v.id === selectedVideoId)?.data} style={{ maxWidth: '100%', height: 'auto' }} />
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 260, overflowY: 'auto', padding: 6 }}>
                          {videos.map((video) => (
                            <div key={video.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <button
                                id={`video-btn-${video.id}`}
                                type="button"
                                className={selectedVideoId === video.id ? 'primary-button' : 'secondary-button'}
                                onClick={() => {
                                  setSelectedVideoId(video.id)
                                  // mark as viewed
                                  setVideos((prev) => prev.map((v) => (v.id === video.id ? { ...v, viewed: true } : v)))
                                }}
                              >
                                {video.title || video.name}
                                {!video.viewed && <span style={{ marginLeft: 6, background: '#c62828', color: '#fff', padding: '2px 6px', borderRadius: 10, fontSize: 12 }}>New</span>}
                              </button>
                              {isAdmin && (
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => {
                                    if (!window.confirm(`Delete video ${video.title || video.name}?`)) return
                                    setVideos((prev) => prev.filter((v) => v.id !== video.id))
                                  }}
                                  title="Remove video"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <h3>Study Materials</h3>
                      {studySubjects.length === 0 ? (
                        <p>No study materials have been added yet.</p>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                          {studySubjects.map((subject) => (
                            <button
                              key={subject}
                              type="button"
                              className={selectedStudySubject === subject ? 'primary-button' : 'secondary-button'}
                              onClick={() => setSelectedStudySubject(subject)}
                            >
                              {subject}
                            </button>
                          ))}
                        </div>
                      )}

                      {selectedStudySubject ? (
                        <div style={{ marginTop: 8 }}>
                          <button type="button" className="secondary-button" onClick={() => setSelectedStudySubject(null)} style={{ marginBottom: 8 }}>
                            ◀ Back to subjects
                          </button>
                          <h4>{selectedStudySubject}</h4>
                          {studyNotes.filter((note) => note.subject === selectedStudySubject).map((material, idx) => (
                            <div key={material.id} style={{ marginBottom: 12, padding: 12, backgroundColor: '#fff', borderRadius: 6, border: '1px solid #ddd' }}>
                              <p style={{ margin: '0 0 6px 0', fontSize: '0.95em' }}><strong>Q{idx + 1}. {material.question}</strong></p>
                              <p style={{ margin: '0 0 6px 0' }}><strong>Answer:</strong> {material.answer}</p>
                              {material.topic && <p style={{ margin: '0 0 6px 0', color: '#666' }}>📌 Topic: {material.topic}</p>}
                              {material.explanation && <p style={{ margin: 0, color: '#555' }}>📝 {material.explanation}</p>}
                              {isAdmin && (
                                <div style={{ marginTop: 8 }}>
                                  <button type="button" className="secondary-button" onClick={() => handleRemoveStudyNote(material.id)}>Remove</button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        studySubjects.length > 0 && <p>Select a subject to view its study notes.</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p>Click a resource button above to open the content on a separate page.</p>
              )}
            </div>
          )}

          {isAdmin && (
            <div className="permission-requests">
              <h3>Permission requests</h3>
              {permissionRequests.length === 0 ? (
                <p>No requests.</p>
              ) : (
                <ul>
                  {permissionRequests.map((p) => (
                    <li key={p.phone}>
                      <div>
                        <strong>{p.phone}</strong> — OTP: <code>{p.otp}</code>
                      </div>
                      <div>
                        <label>Enter OTP to verify: </label>
                        <input
                          type="text"
                          value={otpInputs[p.phone] || ''}
                          onChange={(e) => setOtpInputs((s) => ({ ...s, [p.phone]: e.target.value }))}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const entered = (otpInputs[p.phone] || '').trim()
                            if (entered === p.otp) {
                              // grant: add to users (store password if provided) and permittedPhones
                              setUsers((prev) => ({ ...prev, [p.phone]: p.password || '' }))
                              setPermittedPhones((prev) => (prev.includes(p.phone) ? prev : [...prev, p.phone]))
                              setPermissionRequests((prev) => prev.filter((x) => x.phone !== p.phone))
                              setOtpInputs((s) => {
                                const copy = { ...s }
                                delete copy[p.phone]
                                return copy
                              })
                              setErrorMessage(`Permission granted for ${p.phone}`)
                            } else {
                              setErrorMessage('OTP does not match')
                            }
                          }}
                        >
                          Verify & Grant permission
                        </button>
                        <button type="button" onClick={() => setPermissionRequests((prev) => prev.filter((x) => x.phone !== p.phone))}>
                          Deny
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {isAdmin && (
            <div className="permitted-phones">
              <h3>Permitted phones</h3>
              <PermittedPhonesManager />
            </div>
          )}
          {isAdmin && (
            <div style={{ marginTop: 12 }}>
              <AdminDebugPanel />
            </div>
          )}
          </div>
        </header>

        {isAdmin && (
          <section className="dashboard-controls">
            <div className="search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search questions"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="upload-group">
              <label htmlFor="video-title">Video title</label>
              <input
                id="video-title"
                type="text"
                value={videoTitleInput}
                onChange={(e) => setVideoTitleInput(e.target.value)}
                placeholder="Enter video title"
                style={{ width: '100%' }}
              />
              <label htmlFor="video-upload" className="upload-button">
                📤 Upload video
              </label>
              <input
                id="video-upload"
                type="file"
                accept="video/*"
                hidden
                onChange={handleVideoUpload}
              />
              <p className="upload-note">Upload a video with a title; it will be visible to students.</p>
            </div>
            <div className="import-group">
              <label htmlFor="csv-import" className="upload-button">📥 Import CSV (question,A,B,C,D,answerIndex)</label>
              <input
                id="csv-import"
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={handleImportCSV}
                disabled={questions.length >= 100}
                title={questions.length >= 100 ? 'Import disabled: 100 questions reached' : 'Import CSV (question,A,B,C,D,answerIndex)'}
              />
              {questions.length >= 100 && <p className="upload-note" style={{ color: '#c62828' }}>CSV import disabled: 100 question limit reached.</p>}
            </div>
            <div className="import-group">
              <button type="button" className="secondary-button" onClick={handleClearAllData} style={{ backgroundColor: '#ffebee', color: '#c62828' }}>
                🗑️ Clear All Data
              </button>
              <p className="upload-note">Removes all questions, exams, videos, and user data. Start completely fresh.</p>
            </div>

          </section>
        )}

        <section className="dashboard-card">
          <div className="dashboard-section">
            <h2>Quiz details</h2>
            <label htmlFor="quiz-title">Quiz title</label>
            <input
              id="quiz-title"
              type="text"
              value={quizTitle}
              onChange={(e) => setQuizTitle(e.target.value)}
              placeholder="Enter quiz title"
              disabled={!isAdmin}
            />
            <p className="dashboard-note">
              {isAdmin
                ? 'Set the quiz title and start the quiz when ready.'
                : 'Only admins can edit the quiz title, upload video, or add new questions.'}
            </p>
          </div>

          {videos && videos.length > 0 && (
            <div className="dashboard-section lecture-video">
              <h2>Lecture Videos</h2>
              {videos.map((v, idx) => (
                <div key={v.id} className="video-item">
                  <h3>
                    {idx + 1}. {v.title || v.name}
                  </h3>
                  <video controls src={v.data} style={{ maxWidth: '100%', height: 'auto' }} />
                  {isAdmin && (
                    <div style={{ marginTop: 6 }}>
                      <button type="button" onClick={() => {
                        setVideos((prev) => {
                          const copy = [...prev]
                          const i = copy.findIndex((x) => x.id === v.id)
                          if (i <= 0) return prev
                          const tmp = copy[i-1]
                          copy[i-1] = copy[i]
                          copy[i] = tmp
                          return copy
                        })
                      }} disabled={idx === 0}>Up</button>
                      <button type="button" onClick={() => {
                        setVideos((prev) => {
                          const copy = [...prev]
                          const i = copy.findIndex((x) => x.id === v.id)
                          if (i === -1 || i === copy.length - 1) return prev
                          const tmp = copy[i+1]
                          copy[i+1] = copy[i]
                          copy[i] = tmp
                          return copy
                        })
                      }} disabled={idx === videos.length - 1}>Down</button>
                      <button type="button" onClick={() => setVideos((prev) => prev.filter((x) => x.id !== v.id))}>Remove</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {isAdmin && (
            <div className="dashboard-section">
              <h2>Add question</h2>
              <label htmlFor="question-text">Question text</label>
              <input
                id="question-text"
                type="text"
                value={newQuestionText}
                onChange={(e) => setNewQuestionText(e.target.value)}
                placeholder="Type a question"
              />
              {newOptions.map((option, index) => (
                <div key={index} className="option-row">
                  <label htmlFor={`option-${index}`}>Option {String.fromCharCode(65 + index)}</label>
                  <input
                    id={`option-${index}`}
                    type="text"
                    value={option}
                    onChange={(e) => {
                      const next = [...newOptions]
                      next[index] = e.target.value
                      setNewOptions(next)
                    }}
                    placeholder={`Answer ${String.fromCharCode(65 + index)}`}
                  />
                </div>
              ))}
              <label htmlFor="correct-answer">Correct answer</label>
              <select
                id="correct-answer"
                value={newCorrectIndex}
                onChange={(e) => setNewCorrectIndex(Number(e.target.value))}
              >
                <option value={0}>A</option>
                <option value={1}>B</option>
                <option value={2}>C</option>
                <option value={3}>D</option>
              </select>
              <button
                type="button"
                className="primary-button"
                onClick={handleAddQuestion}
                disabled={!newQuestionText.trim() || newOptions.some((option) => !option.trim()) || questions.length >= 100}
              >
                Add Question
              </button>
            </div>
          )}

          <div className="dashboard-section quiz-summary">
            <h2>Quiz preview</h2>
            <p>Quiz title: <strong>{quizTitle || 'Untitled quiz'}</strong></p>
            <p>
              Showing <strong>{visibleQuestions.length}</strong> of <strong>{questions.length}</strong> questions
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={handleStartQuiz}
              disabled={!quizTitle.trim() || questions.length === 0}
            >
              Start Quiz
            </button>
          </div>
        </section>

        {isAdmin && (
          <section className="dashboard-card">
            <div className="dashboard-section">
              <h2>📚 Study Materials </h2>
              <p>Add study notes for each subject with answers and explanations. Students can study this material independently.</p>
              <label htmlFor="study-subject">Subject *</label>
              <input
                id="study-subject"
                type="text"
                value={newStudySubject}
                onChange={(e) => setNewStudySubject(e.target.value)}
                placeholder="e.g., Biology, Mathematics, History"
                list="study-subjects-list"
              />
              <datalist id="study-subjects-list">
                {studySubjects.map((subj) => (
                  <option key={subj} value={subj} />
                ))}
              </datalist>

              <label htmlFor="study-topic">Topic (optional)</label>
              <input
                id="study-topic"
                type="text"
                value={newStudyTopic}
                onChange={(e) => setNewStudyTopic(e.target.value)}
                placeholder="e.g., Photosynthesis, Calculus"
              />

              <label htmlFor="study-question">Question/Note *</label>
              <textarea
                id="study-question"
                value={newStudyQuestion}
                onChange={(e) => setNewStudyQuestion(e.target.value)}
                placeholder="Enter the question or note"
                rows="2"
              />

              <label htmlFor="study-answer">Answer *</label>
              <textarea
                id="study-answer"
                value={newStudyAnswer}
                onChange={(e) => setNewStudyAnswer(e.target.value)}
                placeholder="Enter the answer"
                rows="2"
              />

              <label htmlFor="study-explanation">Explanation (optional)</label>
              <textarea
                id="study-explanation"
                value={newStudyExplanation}
                onChange={(e) => setNewStudyExplanation(e.target.value)}
                placeholder="Detailed explanation for better learning..."
                rows="3"
              />

              <button
                type="button"
                className="primary-button"
                onClick={handleAddStudyNote}
                disabled={!newStudySubject.trim() || !newStudyQuestion.trim() || !newStudyAnswer.trim()}
              >
                Add Study Material
              </button>
            </div>

            {studySubjects.length > 0 && (
              <div className="dashboard-section">
                <h2>Study Materials by Subject</h2>
                {studySubjects.map((subject) => {
                  const subjectMaterials = studyNotes.filter((n) => n.subject === subject)
                  const isExpanded = expandedSubject === subject
                  return (
                    <div key={subject} style={{ marginTop: '16px', padding: '12px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9' }}>
                      <h3 
                        onClick={() => setExpandedSubject(isExpanded ? null : subject)}
                        style={{ margin: '0 0 8px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                      >
                        <span>{isExpanded ? '▼' : '▶'}</span> {subject}
                      </h3>
                      <p style={{ margin: '0 0 12px 0', fontSize: '0.9em', color: '#666' }}>
                        {subjectMaterials.length} material{subjectMaterials.length !== 1 ? 's' : ''}
                      </p>
                      {isExpanded && subjectMaterials.map((material, idx) => (
                        <div key={material.id} style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fff', borderRadius: '3px', border: '1px solid #e0e0e0' }}>
                          <p style={{ margin: '0 0 4px 0', fontSize: '0.9em' }}><strong>Q{idx + 1}. {material.question}</strong></p>
                          <p style={{ margin: '0 0 4px 0', fontSize: '0.9em' }}><strong>Answer:</strong> {material.answer}</p>
                          {material.topic && <p style={{ margin: '0 0 4px 0', fontSize: '0.85em', color: '#666' }}>📌 Topic: {material.topic}</p>}
                          {material.explanation && <p style={{ margin: '0', fontSize: '0.85em', color: '#555', fontStyle: 'italic' }}>📝 Explanation: {material.explanation}</p>}
                          {isAdmin && (
                            <div style={{ marginTop: 8 }}>
                              <button type="button" className="secondary-button" onClick={() => handleRemoveStudyNote(material.id)}>Remove</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="quiz-app">
      <header className="quiz-header">
        <div className="quiz-header-top">
          <div>
            <h1>{quizTitle}</h1>
            <p>Welcome, {user}. Choose the best answer and submit each question.</p>
          </div>
          <div className="quiz-header-actions">
            <button type="button" className="secondary-button" onClick={handleReturnToDashboard}>
              Back to Dashboard
            </button>
            <button type="button" className="secondary-button" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      {showScore ? (
        <section className="score-card">
          <h2>Your score</h2>
          <p>
            You answered <strong>{score}</strong> of <strong>{currentQuestions.length}</strong> correctly.
          </p>
          <div className="quiz-actions">
            <button type="button" className="primary-button" onClick={handleRestart}>
              Restart Quiz
            </button>
            <button type="button" className="secondary-button" onClick={handleReturnToDashboard}>
              Back to Dashboard
            </button>
          </div>
        </section>
      ) : (
        <section className="question-card">
          {!question ? (
            <div className="empty-state">
              <h2>No questions available</h2>
              <p>Add questions or create an exam before starting the quiz.</p>
              <button type="button" className="secondary-button" onClick={handleReturnToDashboard}>
                Back to Dashboard
              </button>
            </div>
          ) : (
            <>
              <div className="question-top">
                <span className="question-count">
                  Question {currentIndex + 1} of {currentQuestions.length}
                </span>
                <h2>{question.question}</h2>
              </div>

              <div className="options-list">
                {questionOptions.map((option, index) => {
                  let optionClass = 'option-button'
                  if (isAnswered) {
                    if (index === question.answer) optionClass += ' correct'
                    else if (index === selectedOption) optionClass += ' incorrect'
                  } else if (index === selectedOption) {
                    optionClass += ' selected'
                  }

                  return (
                    <button
                      key={index}
                      type="button"
                      className={optionClass}
                      onClick={() => handleOptionClick(index)}
                    >
                      <span className="option-label">{String.fromCharCode(65 + index)}.</span>
                      {option}
                    </button>
                  )
                })}
              </div>

              <div className="quiz-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={isAnswered ? handleNext : handleSubmit}
                  disabled={selectedOption === null}
                >
                  {isAnswered ? (currentIndex + 1 < currentQuestions.length ? 'Next question' : 'Show results') : 'Submit answer'}
                </button>
              </div>

              {isAnswered && (
                <div className="feedback-box">
                  {isCorrect ? (
                    <p className="feedback-correct">Correct! Good job.</p>
                  ) : (
                    <p className="feedback-incorrect">
                      Wrong. The correct answer is <strong>{question.options[question.answer]}</strong>.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}

export default App
