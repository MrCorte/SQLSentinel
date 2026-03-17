import { useContext } from 'react'
import { WorkerContext } from './WorkerContextDef'

export function useWorker() {
  return useContext(WorkerContext)
}
