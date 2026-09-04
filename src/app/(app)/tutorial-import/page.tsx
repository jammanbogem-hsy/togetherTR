'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getProject } from '@/lib/firebase/projects'
import {
  CHEUGUGI_TUTORIAL_TITLE,
  importCompletedCheugugiProject,
  isCompletedCheugugiTutorial,
  type TutorialImportProgress,
} from '@/lib/tutorial/importCompletedProject'
import {
  CHEUGUGI_PERSONAS,
  CHEUGUGI_TUTORIAL_PROJECT_ID,
} from '@/lib/tutorial/cheugugiProject'
import { useProjectStore } from '@/store/project'
import type { Project } from '@/types'

export const dynamic = 'force-dynamic'

export default function TutorialImportPage() {
  const userProfile = useProjectStore((state) => state.userProfile)
  const [targetProject, setTargetProject] = useState<Project | null>(null)
  const [isInspecting, setIsInspecting] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [progress, setProgress] = useState<TutorialImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userProfile) return

    let cancelled = false
    setIsInspecting(true)
    getProject(CHEUGUGI_TUTORIAL_PROJECT_ID)
      .then((project) => {
        if (cancelled) return
        setTargetProject(project)
        setIsComplete(isCompletedCheugugiTutorial(project))
        if (!project) setError('대상 프로젝트를 찾을 수 없습니다.')
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        const message = reason instanceof Error ? reason.message : String(reason)
        setError(`프로젝트 확인 실패: ${message}`)
      })
      .finally(() => {
        if (!cancelled) setIsInspecting(false)
      })

    return () => {
      cancelled = true
    }
  }, [userProfile])

  async function handleImport() {
    if (!userProfile || isImporting || isComplete) return

    setIsImporting(true)
    setError(null)
    setProgress({
      percent: 1,
      stageLabel: '팀준비',
      activityLabel: '공동 비전 설정',
      detail: '가져오기를 시작합니다.',
    })

    try {
      await importCompletedCheugugiProject(userProfile, setProgress)
      const refreshed = await getProject(CHEUGUGI_TUTORIAL_PROJECT_ID)
      setTargetProject(refreshed)
      setIsComplete(true)
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
    } finally {
      setIsImporting(false)
    }
  }

  const isOwner = Boolean(userProfile && targetProject?.createdBy === userProfile.uid)
  const canImport = Boolean(targetProject && isOwner && !isComplete && !isImporting)
  const projectHref = `/projects/${CHEUGUGI_TUTORIAL_PROJECT_ID}`

  return (
    <main className="min-h-screen bg-[#F6F8FC] px-5 py-10 text-[#202124]">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="mb-1 text-sm font-bold text-[#1A73E8]">T-CID 실제 수행 가져오기</p>
            <h1 className="text-2xl font-extrabold tracking-tight">측우기 협력 수업설계 튜토리얼</h1>
          </div>
          <Link
            href="/dashboard"
            className="rounded-xl border border-[#DADCE0] bg-white px-4 py-2 text-sm font-semibold text-[#5F6368] transition-colors hover:bg-[#F1F3F4]"
          >
            대시보드
          </Link>
        </div>

        <section className="rounded-3xl border border-[#DADCE0] bg-white p-6 shadow-sm">
          <div className="mb-5 rounded-2xl bg-[#E8F0FE] p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-[#1A73E8]">완성될 프로젝트</p>
            <h2 className="mt-1 text-lg font-extrabold">{CHEUGUGI_TUTORIAL_TITLE}</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[#5F6368]">대상 ID</dt>
                <dd className="break-all font-mono text-xs font-semibold">{CHEUGUGI_TUTORIAL_PROJECT_ID}</dd>
              </div>
              <div>
                <dt className="text-[#5F6368]">현재 프로젝트명</dt>
                <dd className="font-semibold">{isInspecting ? '확인 중…' : (targetProject?.title ?? '찾을 수 없음')}</dd>
              </div>
            </dl>
          </div>

          <div className="mb-5">
            <h3 className="mb-3 text-sm font-extrabold">현재 교사 1명 + 초대 교사 에이전트 2명</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {userProfile && (
                <article className="rounded-2xl border-2 border-[#1A73E8] bg-[#F8FBFF] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full text-lg"
                      style={{ backgroundColor: `${userProfile.color || '#5B8DEF'}33` }}
                    >
                      {userProfile.emoji || '👩‍🏫'}
                    </span>
                    <div>
                      <p className="text-sm font-extrabold">{userProfile.displayName}</p>
                      <p className="text-xs text-[#1A73E8]">현재 접속 교사 · 방장</p>
                    </div>
                  </div>
                  <p className="text-xs leading-5 text-[#5F6368]">학교 맥락을 제공하고 고위험 결정과 최종 산출물을 승인합니다.</p>
                </article>
              )}
              {CHEUGUGI_PERSONAS.map((persona) => (
                <article key={persona.uid} className="rounded-2xl border border-[#E8EAED] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full text-lg"
                      style={{ backgroundColor: `${persona.color}33` }}
                    >
                      {persona.emoji}
                    </span>
                    <div>
                      <p className="text-sm font-extrabold">{persona.displayName}</p>
                      <p className="text-xs text-[#5F6368]">{persona.role}</p>
                    </div>
                  </div>
                  <p className="text-xs leading-5 text-[#5F6368]">{persona.expertise}</p>
                </article>
              ))}
            </div>
          </div>

          {!isComplete && (
            <div className="mb-5 rounded-2xl border border-[#F9AB00] bg-[#FFF8E1] px-4 py-3 text-sm leading-6 text-[#7A4E00]">
              <strong>실제 데이터 쓰기:</strong> 이 작업은 대상 프로젝트의 기존 활동 대화와 산출물을 지운 뒤,
              총괄 AI가 두 교사 에이전트를 초대한 기록과 19개 전 활동의 교사↔교사·교사↔AI 대화,
              확정 산출물, 단계 보고서로 교체합니다.
              초대 코드는 그대로 유지됩니다.
            </div>
          )}

          {progress && (
            <div className="mb-5 rounded-2xl border border-[#DADCE0] p-4" aria-live="polite">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-bold">{progress.stageLabel} · {progress.activityLabel}</span>
                <span className="font-extrabold text-[#1A73E8]">{progress.percent}%</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-[#E8EAED]"
                role="progressbar"
                aria-label="튜토리얼 프로젝트 가져오기 진행률"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent}
              >
                <div
                  className="h-full rounded-full bg-[#1A73E8] transition-[width] duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-[#5F6368]">{progress.detail}</p>
            </div>
          )}

          {error && (
            <div className="mb-5 rounded-2xl border border-[#F4C7C3] bg-[#FCE8E6] px-4 py-3 text-sm text-[#B3261E]" role="alert">
              {error}
            </div>
          )}

          {isComplete ? (
            <div className="rounded-2xl border border-[#A8DAB5] bg-[#E6F4EA] p-5">
              <p className="font-extrabold text-[#137333]">실제 수행 튜토리얼이 완성되었습니다.</p>
              <p className="mt-1 text-sm leading-6 text-[#3C4043]">
                모든 활동의 대화와 산출물, 단계 보고서가 저장되었습니다. 프로젝트 화면에서 각 활동을 열어 협의 흐름을 확인할 수 있습니다.
              </p>
              <Link
                href={projectHref}
                className="mt-4 inline-flex rounded-xl bg-[#137333] px-5 py-2.5 text-sm font-extrabold text-white transition-colors hover:bg-[#0D652D]"
              >
                완성된 프로젝트 열기 →
              </Link>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleImport}
              disabled={!canImport || isInspecting}
              className="w-full rounded-2xl bg-[#1A73E8] px-5 py-3.5 text-sm font-extrabold text-white transition-colors hover:bg-[#1557B0] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isInspecting
                ? '대상 프로젝트 확인 중…'
                : isImporting
                  ? '19개 활동을 실제 프로젝트에 저장하는 중…'
                  : !targetProject
                    ? '대상 프로젝트를 찾을 수 없음'
                    : !isOwner
                      ? '프로젝트 생성자 계정이 필요함'
                      : '실제 프로젝트에 19개 활동 실행 결과 저장'}
            </button>
          )}
        </section>
      </div>
    </main>
  )
}
