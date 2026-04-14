'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage'
import {
  ArrowClockwise,
  CheckCircle,
  FilePdf,
  SpinnerGap,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { storage } from '@/lib/firebase/config'
import {
  createProjectMaterial,
  deleteProjectMaterial,
  updateProjectMaterial,
  watchProjectMaterials,
} from '@/lib/firebase/materials'
import type { ProjectMaterial } from '@/types'
import type { UserProfile } from '@/lib/auth'

function buildStoragePath(projectId: string, materialId: string, fileName: string): string {
  const safeName = fileName.replace(/[^\w.\-가-힣]/g, '_')
  return `projects/${projectId}/materials/${materialId}/${safeName}`
}

function statusLabel(status: ProjectMaterial['status']): string {
  switch (status) {
    case 'uploaded':
      return '업로드됨'
    case 'processing':
      return '분석 중'
    case 'ready':
      return '준비됨'
    case 'failed':
      return '실패'
    default:
      return status
  }
}

function statusTone(status: ProjectMaterial['status']): string {
  switch (status) {
    case 'ready':
      return 'bg-[#E6F4EA] text-[#137333]'
    case 'processing':
      return 'bg-[#E8F0FE] text-[#1A73E8]'
    case 'failed':
      return 'bg-[#FCE8E6] text-[#C5221F]'
    default:
      return 'bg-[#F1F3F4] text-[#5F6368]'
  }
}

export function ProjectMaterialsModal({
  projectId,
  userProfile,
  onClose,
}: {
  projectId: string
  userProfile: UserProfile | null
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [materials, setMaterials] = useState<ProjectMaterial[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [busyMaterialId, setBusyMaterialId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const unsubscribe = watchProjectMaterials(projectId, setMaterials)
    return () => unsubscribe()
  }, [projectId])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const readyCount = useMemo(
    () => materials.filter((material) => material.status === 'ready').length,
    [materials]
  )

  async function callProcessApi(material: ProjectMaterial) {
    const response = await fetch('/api/materials/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        materialId: material.id,
        downloadURL: material.downloadURL,
        fileName: material.fileName,
      }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: '자료 처리에 실패했습니다.' }))
      throw new Error(payload.error ?? '자료 처리에 실패했습니다.')
    }
  }

  async function handleUpload(file: File) {
    if (!userProfile) {
      setError('로그인 정보가 없어 자료를 업로드할 수 없습니다.')
      return
    }
    if (file.type !== 'application/pdf') {
      setError('PDF 파일만 업로드할 수 있습니다.')
      return
    }

    setError(null)
    setUploading(true)
    setUploadProgress(0)

    let materialId: string | null = null

    try {
      materialId = await createProjectMaterial(projectId, {
        projectId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        status: 'uploaded',
        createdBy: userProfile.uid,
        createdByName: userProfile.displayName,
      })

      const storagePath = buildStoragePath(projectId, materialId, file.name)
      await updateProjectMaterial(projectId, materialId, { storagePath })

      const objectRef = storageRef(storage, storagePath)
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(objectRef, file)
        task.on(
          'state_changed',
          (snapshot) => {
            const progress = snapshot.totalBytes > 0
              ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
              : 0
            setUploadProgress(progress)
          },
          (uploadError) => reject(uploadError),
          () => resolve()
        )
      })

      const downloadURL = await getDownloadURL(objectRef)
      const material: ProjectMaterial = {
        id: materialId,
        projectId,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        storagePath,
        downloadURL,
        status: 'processing',
        createdBy: userProfile.uid,
        createdByName: userProfile.displayName,
      }

      await updateProjectMaterial(projectId, materialId, {
        downloadURL,
        status: 'processing',
      })
      await callProcessApi(material)
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : '자료 업로드에 실패했습니다.'
      setError(message)
      if (materialId) {
        await updateProjectMaterial(projectId, materialId, {
          status: 'failed',
          error: message,
        }).catch(() => undefined)
      }
    } finally {
      setUploading(false)
      setUploadProgress(0)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleReprocess(material: ProjectMaterial) {
    if (!material.downloadURL) {
      setError('다운로드 URL이 없어 재처리를 시작할 수 없습니다.')
      return
    }

    setError(null)
    setBusyMaterialId(material.id)
    try {
      await updateProjectMaterial(projectId, material.id, {
        status: 'processing',
      })
      await callProcessApi(material)
    } catch (reprocessError) {
      setError(reprocessError instanceof Error ? reprocessError.message : '재처리에 실패했습니다.')
    } finally {
      setBusyMaterialId(null)
    }
  }

  async function handleDelete(material: ProjectMaterial) {
    const confirmed = window.confirm(`"${material.fileName}" 자료를 삭제하시겠습니까?`)
    if (!confirmed) return

    setError(null)
    setBusyMaterialId(material.id)
    try {
      if (material.storagePath) {
        await deleteObject(storageRef(storage, material.storagePath)).catch(() => undefined)
      }
      await deleteProjectMaterial(projectId, material.id)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '자료 삭제에 실패했습니다.')
    } finally {
      setBusyMaterialId(null)
    }
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4 py-6">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-[131] flex h-[min(88vh,780px)] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-[#DADCE0] bg-white shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#E8EAED] px-6 py-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1A73E8]">Project Materials</p>
            <h2 className="mt-1 text-[24px] font-black text-[#202124]">자료함</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#5F6368]">
              교과서 PDF를 업로드하면 프로젝트 전 단계에서 참고 근거로 검색합니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F1F3F4] text-[#5F6368] transition-colors hover:bg-[#E8EAED]"
            aria-label="자료함 닫기"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="grid flex-1 min-h-0 grid-cols-[1.1fr_0.9fr]">
          <div className="flex min-h-0 flex-col border-r border-[#E8EAED]">
            <div className="border-b border-[#E8EAED] px-6 py-4">
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) handleUpload(file)
                }}
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[#1A73E8] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#1557B0] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploading ? (
                    <SpinnerGap size={16} className="animate-spin" weight="bold" />
                  ) : (
                    <UploadSimple size={16} weight="bold" />
                  )}
                  PDF 업로드
                </button>
                <p className="text-xs text-[#5F6368]">
                  텍스트형 PDF 우선 지원, 처리 결과는 프로젝트 팀 전체에 공유됩니다.
                </p>
              </div>
              {uploading && (
                <div className="mt-4 space-y-2">
                  <div className="h-2 overflow-hidden rounded-full bg-[#E8F0FE]">
                    <div
                      className="h-full rounded-full bg-[#1A73E8] transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs font-medium text-[#1A73E8]">업로드 진행률 {uploadProgress}%</p>
                </div>
              )}
              {error && (
                <div className="mt-3 rounded-2xl border border-[#FAD2CF] bg-[#FCE8E6] px-4 py-3 text-sm text-[#A50E0E]">
                  {error}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {materials.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[#9AA0A6]">
                  <FilePdf size={44} weight="duotone" className="text-[#AECBFA]" />
                  <div>
                    <p className="text-sm font-semibold text-[#5F6368]">아직 업로드한 자료가 없습니다</p>
                    <p className="mt-1 text-xs leading-relaxed">
                      교과서 PDF를 올리면 분석/설계 단계에서 페이지 근거를 검색해 사용합니다.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {materials.map((material) => {
                    const isBusy = busyMaterialId === material.id
                    return (
                      <div
                        key={material.id}
                        className="rounded-[22px] border border-[#E8EAED] bg-white px-4 py-4 shadow-[0_6px_20px_rgba(60,64,67,0.08)]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusTone(material.status)}`}>
                                {statusLabel(material.status)}
                              </span>
                              {material.textExtractQuality && (
                                <span className="rounded-full bg-[#F1F3F4] px-2.5 py-1 text-[11px] font-semibold text-[#5F6368]">
                                  추출 {material.textExtractQuality}
                                </span>
                              )}
                            </div>
                            <p className="mt-2 break-all text-[15px] font-bold text-[#202124]">{material.fileName}</p>
                            <p className="mt-1 text-xs text-[#5F6368]">
                              {(material.size / 1024 / 1024).toFixed(1)}MB
                              {material.pageCount ? ` · ${material.pageCount}쪽` : ''}
                              {material.chunkCount ? ` · ${material.chunkCount}개 청크` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            {(material.status === 'ready' || material.status === 'failed') && (
                              <button
                                onClick={() => handleReprocess(material)}
                                disabled={isBusy}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#F1F3F4] text-[#5F6368] transition-colors hover:bg-[#E8F0FE] hover:text-[#1A73E8] disabled:opacity-50"
                                aria-label="자료 재처리"
                              >
                                {isBusy ? (
                                  <SpinnerGap size={16} className="animate-spin" weight="bold" />
                                ) : (
                                  <ArrowClockwise size={16} weight="bold" />
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(material)}
                              disabled={isBusy}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#FCE8E6] text-[#C5221F] transition-colors hover:bg-[#FAD2CF] disabled:opacity-50"
                              aria-label="자료 삭제"
                            >
                              <Trash size={16} weight="bold" />
                            </button>
                          </div>
                        </div>

                        {material.summary && (
                          <p className="mt-3 rounded-2xl bg-[#F8F9FA] px-3 py-3 text-sm leading-relaxed text-[#3C4043]">
                            {material.summary}
                          </p>
                        )}

                        {material.error && (
                          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-[#FAD2CF] bg-[#FCE8E6] px-3 py-3 text-sm text-[#A50E0E]">
                            <WarningCircle size={18} weight="fill" className="mt-0.5 flex-shrink-0" />
                            <span>{material.error}</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col bg-[#F8FBFF] px-6 py-5">
            <div className="rounded-[24px] border border-[#D2E3FC] bg-white px-5 py-5 shadow-[0_10px_28px_rgba(26,115,232,0.08)]">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#1A73E8]">RAG Status</p>
              <h3 className="mt-2 text-[20px] font-black text-[#202124]">근거 자료 인덱스</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#5F6368]">
                현재 프로젝트에서 준비된 PDF 자료를 바탕으로 활동별 근거를 검색합니다.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-[#E8F0FE] px-4 py-4">
                  <p className="text-xs font-bold text-[#1A73E8]">준비된 자료</p>
                  <p className="mt-1 text-2xl font-black text-[#202124]">{readyCount}</p>
                </div>
                <div className="rounded-2xl bg-[#E6F4EA] px-4 py-4">
                  <p className="text-xs font-bold text-[#137333]">전체 자료</p>
                  <p className="mt-1 text-2xl font-black text-[#202124]">{materials.length}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3 rounded-[24px] border border-[#E8EAED] bg-white px-5 py-5 shadow-[0_10px_28px_rgba(60,64,67,0.08)]">
              <div className="flex items-center gap-2 text-[#137333]">
                <CheckCircle size={18} weight="fill" />
                <p className="text-sm font-bold">활동별로 자동 검색되는 지점</p>
              </div>
              <ul className="space-y-2 text-sm leading-relaxed text-[#3C4043]">
                <li><strong>A-2-1</strong> 핵심아이디어·성취기준 분석 근거</li>
                <li><strong>A-2-2</strong> 목표 진술을 위한 본문 개념·기능 참고</li>
                <li><strong>A-2-3</strong> 난이도·자료 요구 수준 참고</li>
                <li><strong>Ds-1-3</strong> 학습활동 설계 시 활동자료·예시 탐색</li>
                <li><strong>Ds-2-1 / Ds-2-2</strong> 지원 도구·스캐폴딩 설계 보조</li>
              </ul>
            </div>

            <div className="mt-4 rounded-[24px] border border-[#E8EAED] bg-white px-5 py-5 shadow-[0_10px_28px_rgba(60,64,67,0.08)]">
              <p className="text-sm font-bold text-[#202124]">현재 MVP 범위</p>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[#5F6368]">
                <li>PDF 텍스트 추출 가능한 자료 우선 지원</li>
                <li>검색 결과는 페이지 단위 출처와 함께 agent에 주입</li>
                <li>이미지 중심 페이지와 스캔본은 품질이 낮을 수 있음</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
