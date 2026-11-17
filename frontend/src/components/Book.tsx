export default function Book() {
  return (
    <svg
      className="bookart"
      viewBox="0 0 330 160"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="dots"
          width="9"
          height="9"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="2" cy="2" r="1" fill="#9aafbf" />
        </pattern>
      </defs>
      <circle cx="203" cy="75" r="66" fill="#d5e0e8" />
      <path fill="url(#dots)" d="M43 19h71v51H43zm194 66h61v48h-61z" />
      <g stroke="#243140" strokeWidth="2.3" strokeLinejoin="round">
        <path d="m60 99 122-40 97 42-118 45-101-34z" fill="#3d5668" />
        <path d="m61 98 122-41 95 40-118 44-99-33z" fill="#f4f1ea" />
        <path d="m59 97 121-44 99 42-120 44z" fill="#7a93a6" />
        <path d="m71 85 112-39 83 33-110 45-85-28z" fill="#8a5a2b" />
        <path d="m71 85 112-39 83 32-110 44-85-29z" fill="#f7f2e8" />
        <path d="m69 84 112-43 86 36-111 43z" fill="#c4a06a" />
        <path
          d="m82 69 64-34c18-4 31 1 40 8 14-13 35-18 47-17l37 27-83 48z"
          fill="#1e4d63"
        />
        <path
          d="m83 63 62-33c17-4 30 0 40 8 11-11 32-18 45-17l37 27-81 47z"
          fill="#fffdf8"
        />
        <path
          d="M84 61c19-5 41-26 59-32 17-5 31 0 42 7 13-13 28-20 44-19l37 27-82 48z"
          fill="#dde7ee"
        />
      </g>
    </svg>
  );
}
