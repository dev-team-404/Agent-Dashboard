import { useContext } from 'react';
import { TourContext } from '../components/Tour/TourProvider';

export function useTour() {
  return useContext(TourContext);
}
